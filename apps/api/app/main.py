"""S1 API: authenticated profile and practice sessions."""
import os
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="SpeakLoop API", version="0.1.0")


class NewSession(BaseModel):
    mode: str
    scenario_id: UUID | None = None
    interaction_type: str = "recorded"


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
    rows = await query("practice_sessions", token, "POST", body={"user_id": user_id, "mode": payload.mode, "scenario_id": str(payload.scenario_id) if payload.scenario_id else None, "interaction_type": payload.interaction_type, "status": "created"})
    return rows[0]


@app.get("/v1/sessions")
async def list_sessions(user: tuple[str, str] = Depends(current_user)):
    user_id, token = user
    rows = await query("practice_sessions", token, params={"user_id": f"eq.{user_id}", "select": "id,mode,interaction_type,status,created_at", "order": "created_at.desc", "limit": "50"})
    return {"items": rows, "next_cursor": None}


@app.get("/v1/sessions/{session_id}")
async def get_session(session_id: UUID, user: tuple[str, str] = Depends(current_user)):
    user_id, token = user
    rows = await query("practice_sessions", token, params={"id": f"eq.{session_id}", "user_id": f"eq.{user_id}", "select": "id,mode,interaction_type,status,created_at"})
    if not rows:
        raise HTTPException(404, "Session not found")
    return rows[0]


@app.exception_handler(HTTPException)
async def http_error(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": str(exc.status_code), "message": exc.detail}})
