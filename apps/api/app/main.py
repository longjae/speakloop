"""Authenticated SpeakLoop API."""
import os
import hashlib
import base64
import logging
from datetime import datetime, timezone
from uuid import uuid4
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from app.coaching import RUBRIC_VERSION, generate_feedback, generate_voice

app = FastAPI(title="SpeakLoop API", version="0.1.0")
logger = logging.getLogger(__name__)


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
        messages = {404: '분석할 원본 전사를 찾을 수 없습니다.', 422: '분석할 내용이 짧습니다. 8단어 이상으로 다시 말해 주세요.', 429: '코칭 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'}
        detail = messages.get(response.status_code, '분석을 시작할 수 없습니다.') if table == 'rpc/reserve_coaching' else 'Data request failed'
        raise HTTPException(503 if response.status_code >= 500 else response.status_code, detail)
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
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    api_key = os.getenv("GOOGLE_API_KEY", "")
    model = os.getenv("STT_MODEL", "gemini-3.5-transcribe")
    if model != "gemini-3.5-transcribe":
        raise RuntimeError("Unsupported STT model")
    if not project:
        raise RuntimeError("Vertex AI project is not configured")
    if not api_key:
        raise RuntimeError("Vertex AI API key is not configured")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
    endpoint = f"https://aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent"
    headers = {"x-goog-api-key": api_key}
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
    except httpx.HTTPStatusError as exc:
        try:
            provider_error = exc.response.json().get("error", {})
        except ValueError:
            provider_error = {}
        reasons = [item.get("reason") for item in provider_error.get("details", []) if isinstance(item, dict) and item.get("reason")]
        logger.error(
            "Transcription provider rejected request: http_status=%s code=%s status=%s reasons=%s",
            exc.response.status_code,
            provider_error.get("code"),
            provider_error.get("status"),
            reasons,
        )
        await query("utterances", key, "PATCH", params={"id": f"eq.{utterance_id}"}, body={"stt_status": "failed", "error_code": "STT_PROVIDER_ERROR", "updated_at": datetime.now(timezone.utc).isoformat()})
        raise HTTPException(503, "Transcription failed. Please retry") from exc
    except Exception as exc:
        logger.error("Transcription failed: error_type=%s", type(exc).__name__)
        await query("utterances", key, "PATCH", params={"id": f"eq.{utterance_id}"}, body={"stt_status": "failed", "error_code": "STT_PROVIDER_ERROR", "updated_at": datetime.now(timezone.utc).isoformat()})
        raise HTTPException(503, "Transcription failed. Please retry") from exc


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


class AnalysisRequest(BaseModel):
    utterance_id: UUID


class GuideRequest(BaseModel):
    source_id: UUID
    source_type: str = 'analysis'


async def storage_request(method: str, bucket: str, path: str = '', **kwargs):
    url, _ = settings()
    key = service_key()
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.request(method, f'{url}/storage/v1/{path}', headers={'apikey': key, 'Authorization': f'Bearer {key}', **kwargs.pop('headers', {})}, **kwargs)
    if response.status_code >= 400:
        raise HTTPException(503, '음성 저장소 요청에 실패했습니다. 다시 시도해 주세요.')
    return response


def public_analysis(row: dict) -> dict:
    return {k: row.get(k) for k in ('id','session_id','utterance_id','mode','status','feedback_json','input_source','input_text','rubric_version','audio_status','created_at','error_code')}


async def owned_analysis(analysis_id: UUID | str, user: tuple[str, str]):
    rows = await query('analyses', user[1], params={'id': f'eq.{analysis_id}', 'user_id': f'eq.{user[0]}', 'select': '*'})
    if not rows:
        raise HTTPException(404, '분석 결과를 찾을 수 없습니다.')
    return rows[0]


def provider_failure(stage: str, exc: Exception):
    # Don't log exception strings, prompt, transcript, keys, or generated audio.
    status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
    logger.error('Coaching failed: stage=%s error_type=%s provider_status=%s', stage, type(exc).__name__, status)


async def run_analysis(row: dict):
    key = service_key()
    attempt = row['attempt_count']
    scope = {'id': f"eq.{row['id']}", 'attempt_count': f'eq.{attempt}', 'status': 'eq.processing'}
    try:
        sessions = await query('practice_sessions', key, params={'id': f"eq.{row['session_id']}", 'user_id': f"eq.{row['user_id']}", 'select': 'scenario_id'})
        if not sessions:
            return
        scenario = {}
        if sessions[0].get('scenario_id'):
            scenarios = await query('scenarios', key, params={'id': f"eq.{sessions[0]['scenario_id']}", 'select': 'prompt,goals'})
            scenario = scenarios[0] if scenarios else {}
        feedback = await run_in_threadpool(generate_feedback, row['input_text'], row['mode'], scenario)
        updated = await query('analyses', key, 'PATCH', params=scope, body={'status':'ready','feedback_json': feedback,'error_code':None,'updated_at': datetime.now(timezone.utc).isoformat()})
        if updated:
            await query('practice_sessions', key, 'PATCH', params={'id':f"eq.{row['session_id']}"}, body={'status':'ready'})
    except Exception as exc:
        provider_failure('analysis', exc)
        await query('analyses', key, 'PATCH', params=scope, body={'status':'failed','error_code':'COACH_PROVIDER_ERROR','updated_at':datetime.now(timezone.utc).isoformat()})


@app.post('/v1/sessions/{session_id}/analysis')
async def create_analysis(session_id: UUID, payload: AnalysisRequest, user: tuple[str,str] = Depends(current_user)):
    await owned_session(session_id, user)
    # Atomic reservation validates original transcript ownership, sample length,
    # duplicates, retry attempts and per-user daily provider calls in Postgres.
    rows = await query('rpc/reserve_coaching', service_key(), 'POST', body={'p_user':user[0], 'p_session':str(session_id), 'p_utterance':str(payload.utterance_id), 'p_rubric':RUBRIC_VERSION, 'p_model':os.getenv('COACH_MODEL','gemini-3.5-flash')})
    row = rows[0]
    if row['status'] == 'processing':
        claimed = await query('analyses', service_key(), 'PATCH', params={'id':f"eq.{row['id']}",'status':'eq.processing','worker_started_at':'is.null'}, body={'worker_started_at':datetime.now(timezone.utc).isoformat()})
        if claimed:
            await run_analysis(claimed[0])
            row = await owned_analysis(row['id'], user)
    return JSONResponse(status_code=200 if row['status']=='ready' else 202, content=public_analysis(row))


@app.get('/v1/sessions/{session_id}/analyses')
async def list_analyses(session_id: UUID, user: tuple[str,str] = Depends(current_user)):
    await owned_session(session_id,user)
    rows = await query('analyses',user[1],params={'session_id':f'eq.{session_id}','user_id':f'eq.{user[0]}','select':'*','order':'created_at.desc','limit':'30'})
    return {'items':[public_analysis(row) for row in rows]}


@app.get('/v1/analyses/{analysis_id}')
async def get_analysis(analysis_id: UUID,user: tuple[str,str] = Depends(current_user)):
    return public_analysis(await owned_analysis(analysis_id,user))


async def run_voice(row: dict):
    key = service_key()
    path = f"{row['user_id']}/{row['session_id']}/{row['id']}.wav"
    scope = {'id':f"eq.{row['id']}",'audio_attempts':f"eq.{row['audio_attempts']}",'audio_status':'eq.processing'}
    try:
        audio = await run_in_threadpool(generate_voice,row['feedback_json']['improved_example'])
        still_exists = await query('analyses',key,params={**scope,'select':'id'})
        if not still_exists:
            return
        await storage_request('POST','audio-guides',f'object/audio-guides/{path}',content=audio,headers={'Content-Type':'audio/wav','x-upsert':'true'})
        updated = await query('analyses',key,'PATCH',params=scope,body={'audio_status':'ready','audio_path':path,'audio_updated_at':datetime.now(timezone.utc).isoformat()})
        if not updated:
            await storage_request('DELETE','audio-guides','object/audio-guides',json={'prefixes':[path]})
    except Exception as exc:
        provider_failure('tts',exc)
        await query('analyses',key,'PATCH',params=scope,body={'audio_status':'failed','audio_updated_at':datetime.now(timezone.utc).isoformat()})


async def guide_response(row: dict) -> dict:
    result = {'id':row['id'],'status':row['audio_status'],'playback_url':None,'expires_in':300}
    if row['audio_status']=='ready' and row.get('audio_path'):
        response = await storage_request('POST','audio-guides',f"object/sign/audio-guides/{row['audio_path']}",json={'expiresIn':300})
        signed = response.json()['signedURL']
        result['playback_url'] = signed if signed.startswith('https://') else f'{settings()[0]}/storage/v1{signed}'
    return result


@app.post('/v1/audio-guides')
async def create_guide(payload: GuideRequest,user: tuple[str,str]=Depends(current_user)):
    if payload.source_type!='analysis':
        raise HTTPException(422,'지원하지 않는 음성 가이드입니다.')
    row = await owned_analysis(payload.source_id,user)
    if row['status']!='ready':
        raise HTTPException(409,'분석 완료 후 예문을 들을 수 있습니다.')
    if row['audio_status']=='ready':
        return await guide_response(row)
    if row['audio_status']=='processing' and row.get('audio_updated_at'):
        when = datetime.fromisoformat(row['audio_updated_at'].replace('Z','+00:00'))
        if (datetime.now(timezone.utc)-when).total_seconds()<180:
            return JSONResponse(status_code=202,content=await guide_response(row))
    if row['audio_attempts']>=3:
        raise HTTPException(429,'음성 생성 한도에 도달했습니다. 텍스트 예문을 이용해 주세요.')
    rows = await query('analyses',service_key(),'PATCH',params={'id':f"eq.{row['id']}",'audio_attempts':f"eq.{row['audio_attempts']}",'audio_status':f"eq.{row['audio_status']}"},body={'audio_status':'processing','audio_attempts':row['audio_attempts']+1,'audio_updated_at':datetime.now(timezone.utc).isoformat()})
    if rows:
        row=rows[0]
        await run_voice(row)
        row = await owned_analysis(row['id'], user)
        return await guide_response(row)
    return JSONResponse(status_code=202,content={'id':row['id'],'status':'processing','playback_url':None,'expires_in':300})


@app.get('/v1/audio-guides/{analysis_id}')
async def get_guide(analysis_id: UUID,user: tuple[str,str]=Depends(current_user)):
    return await guide_response(await owned_analysis(analysis_id,user))


def assert_deletable(rows: list[dict]):
    now=datetime.now(timezone.utc)
    for row in rows:
        for status,when in [(row.get('status'),row.get('updated_at')),(row.get('audio_status'),row.get('audio_updated_at'))]:
            if status=='processing' and when and (now-datetime.fromisoformat(when.replace('Z','+00:00'))).total_seconds()<180:
                raise HTTPException(409,'처리가 끝난 후 삭제해 주세요.')


@app.delete('/v1/analyses/{analysis_id}')
async def delete_analysis(analysis_id: UUID,user: tuple[str,str]=Depends(current_user)):
    row=await owned_analysis(analysis_id,user)
    assert_deletable([row])
    if row.get('audio_path'):
        await storage_request('DELETE','audio-guides','object/audio-guides',json={'prefixes':[row['audio_path']]})
    await query('analyses',service_key(),'DELETE',params={'id':f'eq.{analysis_id}','user_id':f'eq.{user[0]}'})
    return {'deleted':True}


@app.delete('/v1/sessions/{session_id}')
async def delete_session(session_id: UUID,user: tuple[str,str]=Depends(current_user)):
    await owned_session(session_id,user)
    key=service_key()
    analyses=await query('analyses',key,params={'session_id':f'eq.{session_id}','user_id':f'eq.{user[0]}','select':'status,updated_at,audio_status,audio_updated_at,audio_path'})
    assert_deletable(analyses)
    utterances=await query('utterances',key,params={'session_id':f'eq.{session_id}','user_id':f'eq.{user[0]}','select':'stt_status,updated_at'})
    assert_deletable([{'status':u['stt_status'],'updated_at':u['updated_at']} for u in utterances])
    uploads=await query('audio_uploads',key,params={'session_id':f'eq.{session_id}','user_id':f'eq.{user[0]}','select':'path'})
    for bucket,paths in [('audio-guides',[a['audio_path'] for a in analyses if a.get('audio_path')]),('recordings',[u['path'] for u in uploads])]:
        if paths:
            await storage_request('DELETE',bucket,f'object/{bucket}',json={'prefixes':paths})
    await query('practice_sessions',key,'DELETE',params={'id':f'eq.{session_id}','user_id':f'eq.{user[0]}'})
    return {'deleted':True}
