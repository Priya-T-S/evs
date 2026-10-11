"""API integration tests against the seeded PostGIS database (run `python -m app.seed.run` first).

Uses an in-process ASGI transport, so no server needs to be running.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture(scope="session")
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _login(client: AsyncClient, email: str) -> dict:
    r = await client.post("/auth/login", json={"email": email, "password": "ecopulse-demo"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_health_and_meta(client):
    assert (await client.get("/health")).json()["database"] is True
    meta = (await client.get("/meta")).json()
    assert len(meta["categories"]) == 17


async def test_error_envelope_and_validation(client):
    r = await client.get("/map/incidents", params={"bbox": "not,a,bbox", "zoom": 12})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    r = await client.get("/incidents/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


async def test_auth_refresh_rotation_and_reuse_detection(client):
    tokens = (await client.post("/auth/guest")).json()
    r1 = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r1.status_code == 200
    # Reusing the rotated token is treated as theft: rejected, and the family is revoked.
    r2 = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r2.status_code == 401
    r3 = await client.post("/auth/refresh", json={"refresh_token": r1.json()["refresh_token"]})
    assert r3.status_code == 401


async def test_rbac(client):
    citizen = await _login(client, "citizen@ecopulse.dev")
    officer = await _login(client, "officer@ecopulse.dev")
    inc = (await client.get("/incidents", params={"limit": 1})).json()["items"][0]
    r = await client.post(f"/incidents/{inc['id']}/assign", json={"team": "X"}, headers=citizen)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert (await client.get("/analytics/overview", headers=citizen)).status_code == 403
    assert (await client.get("/analytics/overview", headers=officer)).status_code == 200
    assert (await client.get("/audit-logs", headers=officer)).status_code == 403


async def test_public_vs_staff_precision(client):
    officer = await _login(client, "officer@ecopulse.dev")
    pub = (await client.get("/incidents", params={"limit": 5})).json()["items"]
    staff = (await client.get("/incidents", params={"limit": 5}, headers=officer)).json()["items"]
    assert all(i["location_precision"].startswith("~") for i in pub)
    assert all(i["location_precision"] == "exact" for i in staff)


async def test_map_zoom_intelligence(client):
    bbox = "77.45,12.82,77.79,13.13"
    city = (await client.get("/map/incidents", params={"bbox": bbox, "zoom": 9})).json()
    street = (await client.get("/map/incidents", params={"bbox": "77.60,12.92,77.65,12.96", "zoom": 15})).json()
    assert city["meta"]["mode"] == "aggregate" and all("count" in f["properties"] for f in city["features"])
    assert street["meta"]["mode"] == "points" and all("priority" in f["properties"] for f in street["features"])
    assert len(city["features"]) < city["meta"]["total"]  # aggregation actually reduces features


async def test_intelligence_endpoints(client):
    hs = (await client.get("/hotspots")).json()["items"]
    assert hs and all(0 <= h["risk_score"] <= 100 for h in hs)
    detail = (await client.get(f"/hotspots/{hs[0]['id']}")).json()
    assert detail["incidents"] and detail["risk"]["model"].startswith("hotspot-1")
    score = (await client.get("/environmental-score", params={"lat": 12.9352, "lon": 77.6245})).json()
    assert score["location"]["name"] == "Koramangala"
    assert set(score["score"]["dimensions"]) == {"air", "water", "waste", "noise", "green", "clean"}
    recs = (await client.get("/recommendations")).json()["items"]
    assert recs and all({"observed", "inference", "actions"} <= set(r) for r in recs)


async def test_verification_flow_updates_counts(client):
    guest = (await client.post("/auth/guest")).json()
    h = {"Authorization": f"Bearer {guest['access_token']}"}
    inc = (await client.get("/incidents", params={"limit": 1, "status": "open"})).json()["items"][0]
    r = await client.post(f"/incidents/{inc['id']}/verify", json={"response": "yes"}, headers=h)
    assert r.status_code == 200
    assert r.json()["counts"]["yes"] >= inc["verify"]["yes"]
    # Answering again updates the same vote rather than double counting.
    r2 = await client.post(f"/incidents/{inc['id']}/verify", json={"response": "unsure"}, headers=h)
    assert r2.json()["counts"]["yes"] == r.json()["counts"]["yes"] - 1


async def test_assistant_is_grounded(client):
    h = await _login(client, "citizen@ecopulse.dev")
    r = (await client.post("/assistant/ask", json={"question": "Where are the worst waste hotspots?"}, headers=h)).json()
    assert r["grounded"] and r["tool_calls"] and r["tool_calls"][0]["tool"] == "worst_hotspots"
    names = {x["name"] for x in (await client.get("/hotspots", params={"domain": "waste"})).json()["items"]}
    assert any(n in r["answer"] for n in names)  # answer cites real hotspots


async def test_guest_upgrade_keeps_identity(client):
    import uuid

    guest = (await client.post("/auth/guest")).json()
    h = {"Authorization": f"Bearer {guest['access_token']}"}
    email = f"upgrade-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post("/auth/register", json={"email": email, "password": "long-password-1", "display_name": "Upgraded"}, headers=h)
    assert r.status_code == 201
    assert r.json()["user"]["id"] == guest["user"]["id"] and r.json()["user"]["is_guest"] is False
    # The guest's old refresh token no longer works.
    assert (await client.post("/auth/refresh", json={"refresh_token": guest["refresh_token"]})).status_code == 401
