"""Environmental assistant.

With an Anthropic API key, Claude answers through a tool-use loop over EcoPulse data
tools (it cannot see anything the tools do not return). Without a key, a deterministic
intent router calls the same tools and renders the results as text. Either way, every
answer is grounded in live EcoPulse data and returns the tool calls it made.
"""

import json
import logging
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import current_user
from app.models import User
from app.modules.assistant import tools as T

log = logging.getLogger("ecopulse.assistant")
router = APIRouter(prefix="/assistant", tags=["assistant"])

SYSTEM = """You are the EcoPulse environmental assistant for {city}. You help citizens and municipal analysts \
understand environmental conditions using EcoPulse data.

Rules:
- Use the tools for every factual claim. Never invent numbers, places, incidents or trends. If the tools do not \
contain the answer, say so plainly.
- Label the origin of what you state: OBSERVED (citizen reports), EXTERNAL (e.g. AQI from Open-Meteo), MODEL \
(scores, risk, forecasts) or RECOMMENDATION (suggested interventions, not facts).
- If a tool result says data is demo/synthetic, mention that the figures come from demo data.
- Be concise: lead with the direct answer, then 2–5 short supporting points with numbers. Plain text, no tables."""


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=12)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)


async def _run_tool(db: AsyncSession, name: str, args: dict, lat, lon) -> dict:
    fn = T.TOOLS.get(name)
    if fn is None:
        return {"error": f"unknown tool {name}"}
    if name == "area_score" and not args.get("location"):
        args = {**args, "lat": lat, "lon": lon}
    try:
        return await fn(db, **args)
    except TypeError as exc:
        return {"error": f"invalid arguments: {exc}"}


async def _ask_claude(db: AsyncSession, body: AskIn) -> dict | None:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=90.0, max_retries=1)
    messages: list = [{"role": t.role, "content": t.content} for t in body.history]
    where = f" The user is at lat {body.lat:.4f}, lon {body.lon:.4f}." if body.lat is not None and body.lon is not None else ""
    messages.append({"role": "user", "content": body.question + where})
    calls: list[dict] = []
    tools = T.TOOL_SCHEMAS
    for _ in range(6):
        try:
            response = await client.beta.messages.create(
                model=settings.ai_model,
                max_tokens=8000,
                system=SYSTEM.format(city=settings.city_name),
                tools=tools,
                messages=messages,
                output_config={"effort": "medium"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError:
            log.warning("assistant rate limited")
            return None
        except anthropic.APIStatusError as exc:
            log.warning("assistant API error %s", exc.status_code)
            return None
        except anthropic.APIConnectionError:
            log.warning("assistant unreachable")
            return None
        if response.stop_reason == "refusal":
            return {"answer": "I can't help with that request.", "tool_calls": calls, "provider": settings.ai_model}
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason != "tool_use":
            answer = "".join(b.text for b in response.content if b.type == "text").strip()
            return {"answer": answer, "tool_calls": calls, "provider": f"claude:{settings.ai_model}"}
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            args = block.input if isinstance(block.input, dict) else json.loads(block.input)
            data = await _run_tool(db, block.name, args, body.lat, body.lon)
            calls.append({"tool": block.name, "args": args})
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(data, default=str)})
        messages.append({"role": "user", "content": results})
    return {"answer": "I needed too many steps to answer that. Try a more specific question.", "tool_calls": calls, "provider": f"claude:{settings.ai_model}"}


# --------------------------------------------------------------------------- deterministic fallback


def _domain_in(q: str) -> str | None:
    for d, words in {
        "waste": ["waste", "garbage", "trash", "dump", "plastic"],
        "air": ["air", "aqi", "smoke", "dust", "burning", "pollution"],
        "water": ["water", "sewage", "lake"],
        "noise": ["noise", "loud", "honk"],
        "flood": ["flood", "waterlog", "drain", "rain"],
        "green": ["green", "tree"],
    }.items():
        if any(w in q for w in words):
            return d
    return None


def _fmt_dims(d: dict) -> str:
    return ", ".join(f"{k} {round(v)}" for k, v in sorted(d.items(), key=lambda kv: kv[1]))


async def _ask_local(db: AsyncSession, body: AskIn) -> dict:
    q = body.question.lower()
    names = [n for (n,) in await db.execute(text("SELECT name FROM locations"))]
    loc = next((n for n in sorted(names, key=len, reverse=True) if n.lower() in q), None)
    days = int(m.group(1)) if (m := re.search(r"(\d+)\s*days?", q)) else (7 if "week" in q else 30)
    domain = _domain_in(q)
    calls: list[dict] = []

    async def call(name: str, **args) -> dict:
        calls.append({"tool": name, "args": {k: v for k, v in args.items() if v is not None}})
        return await _run_tool(db, name, {k: v for k, v in args.items() if v is not None}, body.lat, body.lon)

    if any(w in q for w in ("changed", "change", "trend", "this month", "last month", "recent")):
        r = await call("recent_changes", days=days, location=loc)
        lines = [f"Changes over the last {r['period_days']} days ({r['scope']}). {r['provenance']}."]
        lines.append(f"• {r['incidents_new']} new incidents, {r['incidents_resolved']} resolved.")
        for d in r["reports_by_domain"][:4]:
            lines.append(f"• {d['domain'].title()}: {d['this_period']} reports ({d['change_pct']:+d}% vs previous period).")
        if r["rising_hotspots"]:
            h = r["rising_hotspots"][0]
            lines.append(f"• Fastest-rising hotspot: {h['name']} (+{h['trend_pct_14d']:.0f}% reports in 14 days).")
        if r["score_changes"]:
            s = r["score_changes"][0]
            lines.append(f"• Biggest score move: {s['location']} {s['before']:.0f} → {s['now']:.0f}.")
        answer = "\n".join(lines)
    elif "flood" in q or "rain" in q or "waterlog" in q:
        r = await call("flood_outlook")
        top = r["areas"][:4]
        lines = ["Flood outlook. PREDICTED risk is a model (flood-1); OBSERVED flooding is from citizen reports in the last 72 h."]
        for a in top:
            lines.append(
                f"• {a['location']}: predicted {a['predicted_risk_peak']:.2f}, observed {a['observed_flooding_72h']:.2f}, rain window {a['rain_mm_window'] or 0} mm"
                + (" (demo weather)" if a["weather_is_demo"] else "")
            )
        answer = "\n".join(lines)
    elif "green" in q or "tree" in q:
        r = await call("green_cover_needs", limit=5)
        lines = ["Areas that most need green cover (MODEL green score from EXTERNAL OpenStreetMap green areas):"]
        for a in r["lowest_green_scores"]:
            lines.append(f"• {a['location']}: green score {a['green_score']:.0f}, {a['green_area_share'] * 100:.1f}% of area is green.")
        if r["recommended_corridors"]:
            lines.append("RECOMMENDED corridors: " + "; ".join(c["title"] for c in r["recommended_corridors"]) + ".")
        answer = "\n".join(lines)
    elif any(w in q for w in ("intervention", "recommend", "should", "what can", "fix")):
        r = await call("list_recommendations", kind=domain if domain and domain != "air" else None, location=loc, limit=5)
        lines = ["Open RECOMMENDATIONS (suggestions derived from observed data, not facts):"]
        for x in r["recommendations"]:
            lines.append(f"• {x['title']} — impact {x['expected_impact']}, confidence {x['confidence']:.0%}. Top action: {x['top_actions'][0] if x['top_actions'] else 'n/a'}.")
        answer = "\n".join(lines) if r["recommendations"] else "There are no open recommendations matching that."
    elif any(w in q for w in ("worst", "hotspot", "where are", "most")):
        r = await call("worst_hotspots", domain=domain, limit=5)
        lines = [f"Highest-risk {domain + ' ' if domain else ''}hotspots (MODEL hotspot-1 over OBSERVED reports):"]
        for h in r["hotspots"]:
            lines.append(f"• {h['name']}: risk {h['risk']:.0f}, {h['reports']} reports, {h['active_incidents']} open incidents, trend {h['trend_pct_14d']:+.0f}%. Main issue: {h['primary_issue']}.")
        answer = "\n".join(lines) if r["hotspots"] else "No active hotspots match that."
    elif any(w in q for w in ("score", "why", "my area", "pulse", "how is", "how's")) or loc:
        r = await call("area_score", location=loc)
        if "error" in r:
            answer = "I couldn't match that to a neighbourhood. Known areas: " + ", ".join(r.get("known_locations", [])[:12]) + "."
        else:
            weak = r["weakest_dimensions"] or []
            lines = [f"{r['location']} scores {r['overall']:.0f}/100 ({r['grade']}), ranked {r['city_rank']} in the city. {r['provenance']}."]
            lines.append(f"• Dimensions: {_fmt_dims(r['dimensions'])}.")
            for w in weak:
                exp = (r["explanation"] or {}).get(w, {})
                detail = f"{exp.get('open_incidents', 0)} open {w} incidents" if "open_incidents" in exp else exp.get("method", "")
                if w == "air" and exp.get("external"):
                    detail += f", AQI {exp['external']['us_aqi']}" + (" (demo)" if exp["external"].get("is_demo") else "")
                if w == "green":
                    detail = f"{(exp.get('green_area_share') or 0) * 100:.1f}% green area"
                if w == "clean" and exp.get("incidents_60d"):
                    detail = (
                        f"{(exp.get('resolved_share') or 0) * 100:.0f}% of {exp['incidents_60d']} recent incidents resolved, "
                        f"median {exp.get('median_days_open') or 0:.0f} days open"
                    )
                lines.append(f"• Weakest: {w} — {detail}.")
            if r["top_open_incidents"]:
                t = r["top_open_incidents"][0]
                lines.append(f"• Riskiest open issue: {t['ref']} {t['title']} ({t['priority']}, risk {t['risk']:.0f}, {t['reporters']} reporters).")
            answer = "\n".join(lines)
    else:
        answer = (
            "I can answer questions using EcoPulse data, for example: “Why is Koramangala's score low?”, "
            "“Where are the worst waste hotspots?”, “What changed this month?”, “Which areas need more green cover?”, "
            "“What interventions are recommended?”, or “What's the flood outlook?”"
        )
    return {"answer": answer, "tool_calls": calls, "provider": "local-intent-router"}


@router.post("/ask")
async def ask(body: AskIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await ratelimit.enforce(f"assistant:{user.id}", 30, 3600)
    result = None
    if settings.anthropic_api_key:
        result = await _ask_claude(db, body)
    if result is None:
        result = await _ask_local(db, body)
    result["grounded"] = True
    return result
