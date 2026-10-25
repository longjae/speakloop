from fastapi.testclient import TestClient
from app.main import app, current_user
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa


client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_openapi_has_s1_routes():
    routes = client.get("/openapi.json").json()["paths"]
    assert "/v1/me" in routes
    assert "/v1/sessions/{session_id}" in routes


def test_session_lookup_is_scoped_to_token_user(monkeypatch):
    from app import main
    seen = {}

    async def fake_query(table, token, method="GET", *, params=None, body=None):
        seen.update(table=table, token=token, params=params)
        return []

    app.dependency_overrides[current_user] = lambda: ("00000000-0000-0000-0000-000000000001", "token")
    monkeypatch.setattr(main, "query", fake_query)
    try:
        response = client.get("/v1/sessions/00000000-0000-0000-0000-000000000002")
        assert response.status_code == 404
        assert seen["params"]["user_id"] == "eq.00000000-0000-0000-0000-000000000001"
        assert seen["token"] == "token"
    finally:
        app.dependency_overrides.clear()


def test_create_session_uses_token_owner(monkeypatch):
    from app import main
    seen = {}

    async def fake_query(table, token, method="GET", *, params=None, body=None):
        seen.update(body=body, method=method)
        return [{"id": "10000000-0000-0000-0000-000000000001", **body}]

    app.dependency_overrides[current_user] = lambda: ("00000000-0000-0000-0000-000000000001", "token")
    monkeypatch.setattr(main, "query", fake_query)
    try:
        response = client.post("/v1/sessions", json={"mode": "opic", "user_id": "00000000-0000-0000-0000-000000000002"})
        assert response.status_code == 201
        assert seen["body"]["user_id"] == "00000000-0000-0000-0000-000000000001"
        assert seen["method"] == "POST"
    finally:
        app.dependency_overrides.clear()


def test_jwt_audience_is_checked(monkeypatch):
    from app import main
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(main, "settings", lambda: ("https://example.supabase.co", "public-key"))
    monkeypatch.setattr(jwt.PyJWKClient, "get_signing_key_from_jwt", lambda self, token: SimpleNamespace(key=private_key.public_key()))
    claims = {"sub": "00000000-0000-0000-0000-000000000001", "aud": "other", "iss": "https://example.supabase.co/auth/v1", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}
    token = jwt.encode(claims, private_key, algorithm="RS256")
    response = client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_vertex_transcript_uses_audio_and_preserves_raw_text(monkeypatch):
    from app import main
    monkeypatch.setenv("GOOGLE_API_KEY", "test-only")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "speakloop-512602")
    seen = {}

    def fake_post(url, *, headers, json, timeout):
        seen.update(url=url, headers=headers, body=json)
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"candidates": [{"content": {"parts": [{"text": "Um, I went to the cafe."}]}}]})

    monkeypatch.setattr(main.httpx, "post", fake_post)
    assert main.transcribe_audio(b"sample", "audio/m4a") == "Um, I went to the cafe."
    assert "/projects/speakloop-512602/locations/global/" in seen["url"]
    assert seen["body"]["generationConfig"]["audioTranscriptionConfig"]["mode"] == "VERBATIM"
    assert seen["body"]["contents"][0]["parts"][0]["inlineData"]["mimeType"] == "audio/m4a"
    assert "test-only" not in str(seen["body"])


def test_upload_rejects_unsupported_audio_before_reservation(monkeypatch):
    from app import main

    async def fake_owned_session(session_id, user):
        return None

    monkeypatch.setattr(main, "owned_session", fake_owned_session)
    app.dependency_overrides[current_user] = lambda: ("00000000-0000-0000-0000-000000000001", "token")
    try:
        response = client.post("/v1/sessions/00000000-0000-0000-0000-000000000002/uploads", json={"mime_type": "text/plain", "size_bytes": 10, "duration_ms": 1000, "idempotency_key": "00000000-0000-0000-0000-000000000003"})
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()
