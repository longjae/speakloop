"""Authenticated SpeakLoop API."""
import os
import hashlib
import base64
from datetime import datetime, timezone
from uuid import uuid4
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="SpeakLoop API", version="0.1.0")


class NewSession(BaseModel):
    mode: str
    scenario_id: UUID | None = None
    interaction_type: str = "recorded"


class NewUpload(BaseModel):
    mime_type: str
    size_bytes: int
    duration_ms: int
    idempotency_key: UUID


class NewUtterance(BaseModel):
    upload_id: UUID


class TranscriptEdit(BaseModel):
    text: str


def settings() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY", "")
    if not url or not anon_key:
        raise HTTPException(503, "Supabase is not configured")
    return url, anon_key


def current_user(authorization: str | None = Header(default=None)) -> tuple[str, str]:
    url, _ = settings()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    token = authorization.removeprefix("Bearer ")
    try:
        jwks = jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json")
        key = jwks.get_signing_key_from_jwt(token)
        claims = jwt.decode(token, key.key, algorithms=["RS256", "ES256"], audience="authenticated", issuer=f"{url}/auth/v1")
        return str(UUID(claims["sub"])), token
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise HTTPException(401, "Invalid access token") from exc


async def query(table: str, token: str, method: str = "GET", *, params=None, body=None):
    url, anon_key = settings()
    headers = {"apikey": anon_key, "Authorization": f"Bearer {token}", "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.request(method, f"{url}/rest/v1/{table}", headers=headers, params=params, json=body)
    if response.status_code >= 400:
        raise HTTPException(503 if response.status_code >= 500 else response.status_code, "Data request failed")
    return response.json() if response.content else None


def service_key() -> str:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        raise HTTPException(503, "Storage service is not configured")
    return key


async def owned_session(session_id: UUID, user: tuple[str, str]):
    rows = await query("practice_sessions", user[1], params={"id": f"eq.{session_id}", "user_id": f"eq.{user[0]}", "select": "id"})
    if not rows:
        raise HTTPException(404, "Session not found")


def transcribe_audio(audio: bytes, mime_type: str) -> str:
    import google.auth
    from google.auth.transport.requests import Request

    project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    api_key = os.getenv("GOOGLE_API_KEY", "")
    model = os.getenv("STT_MODEL", "gemini-3.5-transcribe")
    if model != "gemini-3.5-transcribe":
        raise RuntimeError("Unsupported STT model")
    if not project:
        raise RuntimeError("Vertex AI project is not configured")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
    endpoint = f"https://aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent"
    if api_key:
        headers = {"x-goog-api-key": api_key}
    else:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        credentials.refresh(Request())
        headers = {"Authorization": f"Bearer {credentials.token}"}
    payload = {"contents": [{"role": "user", "parts": [{"inlineData": {"mimeType": mime_type, "data": base64.b64encode(audio).decode("ascii")}}]}], "generationConfig": {"audioTranscriptionConfig": {"mode": "VERBATIM", "languageCodes": ["en-US"]}}}
    response = httpx.post(endpoint, headers=headers, json=payload, timeout=90)
    response.raise_for_status()
    content = response.json()
    parts = content.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "".join(part.get("text") or part.get("audioTranscription", {}).get("text", "") for part in parts).strip()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/v1/me")
async def me(user: tuple[str, str] = Depends(current_user)):
    user_id, token = user
    rows = await query("profiles", token, params={"id": f"eq.{user_id}", "select": "id,settings"})
    return rows[0] if rows else {"id": user_id, "settings": {}}


@app.post("/v1/sessions", status_code=201)
async def create_session(payload: NewSession, user: tuple[str, str] = Depends(current_user)):
    if payload.mode not in {"opic", "daily"} or payload.interaction_type not in {"recorded", "turn"}:
        raise HTTPException(422, "Unsupported practice mode")
    user_id, token = user
    scenario_version = None
    if payload.scenario_id:
        scenarios = await query("scenarios", token, params={"id": f"eq.{payload.scenario_id}", "mode": f"eq.{payload.mode}", "active": "eq.true", "select": "id,version"})
        if not scenarios:
            raise HTTPException(422, "Scenario is unavailable for this mode")
        scenario_version = scenarios[0]["version"]
    body = {"user_id": user_id, "mode": payload.mode, "scenario_id": str(payload.scenario_id) if payload.scenario_id else None, "interaction_type": payload.interaction_type, "status": "created"}
    if scenario_version is not None:
        body["scenario_version"] = scenario_version
    rows = await query("practice_sessions", token, "POST", body=body)
    return rows[0]


@app.get("/v1/scenarios")
async def list_scenarios(mode: str | None = None, level: str | None = None, user: tuple[str, str] = Depends(current_user)):
    if mode is not None and mode not in {"opic", "daily"}:
        raise HTTPException(422, "Unsupported practice mode")
    if level is not None and level not in {"beginner", "intermediate"}:
        raise HTTPException(422, "Unsupported level")
    params = {"active": "eq.true", "select": "id,mode,level,title,prompt,goals,version", "order": "title.asc", "limit": "50"}
    if mode:
        params["mode"] = f"eq.{mode}"
    if level:
        params["level"] = f"eq.{level}"
    rows = await query("scenarios", user[1], params=params)
    return {"items": rows, "next_cursor": None}


@app.get("/v1/scenarios/{scenario_id}")
async def get_scenario(scenario_id: UUID, user: tuple[str, str] = Depends(current_user)):
    rows = await query("scenarios", user[1], params={"id": f"eq.{scenario_id}", "active": "eq.true", "select": "id,mode,level,title,prompt,goals,version"})
    if not rows:
        raise HTTPException(404, "Scenario not found")
    return rows[0]


@app.get("/v1/sessions")
async def list_sessions(user: tuple[str, str] = Depends(current_user)):
    user_id, token = user
    rows = await query("practice_sessions", token, params={"user_id": f"eq.{user_id}", "select": "id,mode,interaction_type,status,created_at", "order": "created_at.desc", "limit": "50"})
    return {"items": rows, "next_cursor": None}


@app.get("/v1/sessions/{session_id}")
async def get_session(session_id: UUID, user: tuple[str, str] = Depends(current_user)):
    user_id, token = user
    rows = await query("practice_sessions", token, params={"id": f"eq.{session_id}", "user_id": f"eq.{user_id}", "select": "id,mode,scenario_id,interaction_type,status,created_at"})
    if not rows:
        raise HTTPException(404, "Session not found")
    return rows[0]


@app.get("/v1/sessions/{session_id}/utterances")
async def list_utterances(session_id: UUID, user: tuple[str, str] = Depends(current_user)):
    await owned_session(session_id, user)
    rows = await query("utterances", user[1], params={"session_id": f"eq.{session_id}", "user_id": f"eq.{user[0]}", "select": "id,transcript_raw,transcript_edited,stt_status", "order": "created_at.desc", "limit": "20"})
    return {"items": rows}


@app.post("/v1/sessions/{session_id}/uploads", status_code=201)
async def reserve_upload(session_id: UUID, payload: NewUpload, user: tuple[str, str] = Depends(current_user)):
    await owned_session(session_id, user)
    if payload.mime_type != "audio/mp4" or not 1 <= payload.size_bytes <= 10_485_760 or not 1000 <= payload.duration_ms <= 120_000:
        raise HTTPException(422, "Unsupported recording")
    existing = await query("audio_uploads", user[1], params={"user_id": f"eq.{user[0]}", "idempotency_key": f"eq.{payload.idempotency_key}", "select": "id,path,session_id"})
    if existing:
        if existing[0]["session_id"] != str(session_id):
            raise HTTPException(409, "Upload key belongs to another session")
        return {"upload_id": existing[0]["id"], "path": existing[0]["path"]}
    today = datetime.now(timezone.utc).date().isoformat()
    daily = await query("audio_uploads", user[1], params={"user_id": f"eq.{user[0]}", "created_at": f"gte.{today}T00:00:00Z", "select": "id", "limit": "21"})
    if len(daily) >= 20:
        raise HTTPException(429, "Daily transcription limit reached")
    upload_id = str(uuid4())
    path = f"{user[0]}/{session_id}/{upload_id}.m4a"
    rows = await query("audio_uploads", service_key(), "POST", body={"id": upload_id, "session_id": str(session_id), "user_id": user[0], "idempotency_key": str(payload.idempotency_key), "path": path, "mime_type": payload.mime_type, "size_bytes": payload.size_bytes, "duration_ms": payload.duration_ms})
    return {"upload_id": rows[0]["id"], "path": path}


@app.post("/v1/sessions/{session_id}/utterances")
async def create_utterance(session_id: UUID, payload: NewUtterance, user: tuple[str, str] = Depends(current_user)):
    await owned_session(session_id, user)
    uploads = await query("audio_uploads", user[1], params={"id": f"eq.{payload.upload_id}", "session_id": f"eq.{session_id}", "user_id": f"eq.{user[0]}", "select": "id,path,mime_type,size_bytes"})
    if not uploads:
        raise HTTPException(404, "Upload not found")
    upload = uploads[0]
    existing = await query("utterances", user[1], params={"upload_id": f"eq.{payload.upload_id}", "select": "id,transcript_raw,transcript_edited,stt_status,updated_at"})
    if existing and existing[0]["stt_status"] in {"ready", "empty"}:
        return existing[0]
    if existing and existing[0]["stt_status"] == "processing":
        last_update = datetime.fromisoformat(existing[0]["updated_at"].replace("Z", "+00:00"))
        if (datetime.now(timezone.utc) - last_update).total_seconds() < 120:
            raise HTTPException(409, "Transcription is already processing")
    key = service_key()
    url, _ = settings()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{url}/storage/v1/object/recordings/{upload['path']}", headers=headers)
    if response.status_code != 200:
        raise HTTPException(409, "Recording is not uploaded")
    audio = response.content
    if len(audio) != upload["size_bytes"] or len(audio) > 10_485_760 or not audio.startswith(b"\x00\x00") or b"ftyp" not in audio[:32]:
        raise HTTPException(422, "Recording file is invalid")
    checksum = hashlib.sha256(audio).hexdigest()
    await query("audio_uploads", key, "PATCH", params={"id": f"eq.{payload.upload_id}"}, body={"checksum": checksum})
    if existing:
        utterance_id = existing[0]["id"]
        await query("utterances", key, "PATCH", params={"id": f"eq.{utterance_id}"}, body={"stt_status": "processing", "error_code": None, "updated_at": datetime.now(timezone.utc).isoformat()})
    else:
        rows = await query("utterances", key, "POST", body={"session_id": str(session_id), "user_id": user[0], "upload_id": str(payload.upload_id), "stt_status": "processing"})
        utterance_id = rows[0]["id"]
    try:
        transcript = await run_in_threadpool(transcribe_audio, audio, "audio/m4a")
        status = "ready" if transcript else "empty"
        rows = await query("utterances", key, "PATCH", params={"id": f"eq.{utterance_id}"}, body={"transcript_raw": transcript, "stt_status": status, "error_code": None, "updated_at": datetime.now(timezone.utc).isoformat()})
        return {k: rows[0][k] for k in ("id", "transcript_raw", "transcript_edited", "stt_status")}
    except Exception:
        await query("utterances", key, "PATCH", params={"id": f"eq.{utterance_id}"}, body={"stt_status": "failed", "error_code": "STT_PROVIDER_ERROR", "updated_at": datetime.now(timezone.utc).isoformat()})
        raise HTTPException(503, "Transcription failed. Please retry")


@app.patch("/v1/utterances/{utterance_id}/transcript")
async def edit_transcript(utterance_id: UUID, payload: TranscriptEdit, user: tuple[str, str] = Depends(current_user)):
    text = payload.text.strip()
    if not text or len(text) > 5000:
        raise HTTPException(422, "Transcript length is invalid")
    rows = await query("utterances", user[1], params={"id": f"eq.{utterance_id}", "user_id": f"eq.{user[0]}", "select": "id"})
    if not rows:
        raise HTTPException(404, "Transcript not found")
    rows = await query("utterances", service_key(), "PATCH", params={"id": f"eq.{utterance_id}", "user_id": f"eq.{user[0]}"}, body={"transcript_edited": text})
    return {"id": rows[0]["id"], "transcript_edited": rows[0]["transcript_edited"]}


@app.exception_handler(HTTPException)
async def http_error(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": str(exc.status_code), "message": exc.detail}})
