"""Seed EcoPulse with a realistic, clearly-labelled demo dataset.

    python -m app.seed.run            # seed an empty database
    python -m app.seed.run --reset    # wipe all data first
    python -m app.seed.run --drives   # add demo clean-up drives to an already seeded database

Every synthetic record has ``is_demo = true``. Synthetic reports are pushed through the
real report pipeline (classification, duplicate detection, incident aggregation), so
the demo exercises exactly the same code as production traffic.
"""

import argparse
import asyncio
import logging
import math
import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.core.catalog import CATEGORIES
from app.core.db import SessionLocal
from app.core.geo import cell, wkt_point
from app.core.security import hash_password
from app.intelligence import grid as gridlib
from app.intelligence import hotspots, recommendations, scores
from app.models import CleanupDrive, DriveParticipant, Incident, IncidentEvent, Report, ResolutionUpdate, User, Verification
from app.modules.reports.pipeline import process_report
from app.providers import service as external
from app.seed.demo_geo import CITY_BBOX, NEIGHBORHOODS

log = logging.getLogger("ecopulse.seed")
rng = random.Random(20261008)

DEMO_PASSWORD = "ecopulse-demo"
STAFF = [
    ("admin@ecopulse.dev", "Asha Rao", "admin", None),
    ("officer@ecopulse.dev", "Vikram Shetty", "officer", "Solid Waste Management"),
    ("officer.water@ecopulse.dev", "Meera Iyer", "officer", "Lakes & Water Quality"),
    ("analyst@ecopulse.dev", "Rahul Menon", "analyst", "Environmental Analytics"),
    ("moderator@ecopulse.dev", "Fatima Khan", "moderator", None),
]
TEAMS = {
    "waste": "Solid Waste Management",
    "water": "Lakes & Water Quality",
    "air": "Pollution Control Cell",
    "noise": "Traffic & Noise Enforcement",
    "green": "Forest Cell",
    "flood": "Stormwater Drains",
    "other": "Ward Office",
}

# Storylines: (centre lat, lon, spread m, [(category, weight)], reports, days span, trend, resolve share, descriptions, noise range)
STORIES = [
    ("Koramangala 8th Block waste", 12.9395, 77.6190, 260, [("garbage", 5), ("illegal_dumping", 3), ("plastic_waste", 2)], 95, 60, "rising", 0.15,
     ["Garbage piled up near the corner, not collected for days", "Overflowing bin, waste spilling onto the road", "Construction debris and plastic dumped on the footpath",
      "Huge garbage heap next to the bus stop, terrible smell", "Mixed waste dumped overnight near the park", "Plastic bags and bottles everywhere along the drain"], None),
    ("HSR Layout Sector 2 garbage", 12.9105, 77.6420, 220, [("garbage", 5), ("plastic_waste", 2), ("dead_animals", 1)], 55, 50, "steady", 0.35,
     ["Garbage not collected this week", "Bin overflowing again near 27th main", "Dead dog on the roadside near the garbage pile", "Waste dumped in the vacant plot"], None),
    ("Bellandur lake foam", 12.9370, 77.6680, 400, [("water_pollution", 5), ("sewage", 3)], 70, 70, "steady", 0.05,
     ["White toxic foam floating on the lake, spreading to the road", "Froth from the lake blowing onto vehicles", "Sewage flowing directly into the lake from the drain",
      "Discoloured water and dead fish near the lake edge", "Strong chemical stench from the lake"], None),
    ("Whitefield contaminated water", 12.9715, 77.7480, 200, [("water_pollution", 4), ("sewage", 2)], 32, 12, "rising", 0.0,
     ["Tap water is yellow and smells of sewage, children falling sick", "Contaminated water supply in our apartment near the school",
      "Sewage mixing with drinking water line, dangerous", "Discoloured water from borewell, smells of chemical"], None),
    ("Silk Board junction air and noise", 12.9177, 77.6238, 300, [("air_pollution", 3), ("noise_pollution", 4)], 60, 60, "steady", 0.1,
     ["Constant honking at the junction, unbearable noise", "Thick exhaust smoke from buses stuck in traffic", "Air quality terrible, breathing problems near the flyover", "Loud honking late at night"], (72, 92)),
    ("Marathahalli construction dust", 12.9560, 77.7000, 300, [("construction_dust", 5), ("air_pollution", 1)], 40, 45, "rising", 0.1,
     ["Construction site with no dust screening, cement dust everywhere", "Dust from demolition covering the whole street", "Sand trucks uncovered, dust blowing into houses"], None),
    ("KR Puram e-waste burning", 13.0090, 77.6990, 350, [("e_waste", 3), ("open_burning", 4)], 38, 40, "rising", 0.1,
     ["Electronic waste being burnt in the open, toxic smoke", "Piles of old monitors and batteries dumped near the railway", "Burning wires at night, black smoke", "E-waste dumped in the empty lot"], None),
    ("Hebbal waterlogging", 13.0380, 77.5920, 350, [("waterlogging", 4), ("flooding", 2), ("drainage", 3)], 45, 55, "steady", 0.3,
     ["Road waterlogged after light rain, knee deep water", "Underpass flooded, vehicles stuck", "Blocked drain causing water to stagnate for days", "Storm drain clogged with plastic"], None),
    ("Electronic City drainage", 12.8460, 77.6640, 300, [("drainage", 4), ("waterlogging", 3), ("sewage", 1)], 30, 45, "rising", 0.2,
     ["Drain overflowing onto the service road", "Clogged nala, mosquitoes breeding", "Stagnant water near phase 1 for a week"], None),
    ("Majestic garbage", 12.9775, 77.5720, 250, [("garbage", 4), ("dead_animals", 1), ("plastic_waste", 2)], 40, 60, "falling", 0.55,
     ["Garbage near the bus stand not cleared", "Plastic waste dumped behind the market", "Dead animal near the waste heap"], None),
    ("Malleshwaram tree felling", 13.0050, 77.5700, 400, [("illegal_tree_cutting", 3), ("tree_loss", 2)], 18, 40, "steady", 0.2,
     ["Old rain trees being cut without any notice", "Tree felled overnight for parking", "Huge branches chopped, tree dying"], None),
    ("Indiranagar nightlife noise", 12.9720, 77.6400, 300, [("noise_pollution", 5)], 30, 40, "steady", 0.2,
     ["Loud music from pub past midnight", "Speakers blaring on the street at night", "Noise from the bar is unbearable, near the hospital"], (68, 88)),
    ("Indiranagar dumping (resolved)", 12.9650, 77.6450, 150, [("illegal_dumping", 4), ("garbage", 1)], 20, 70, "falling", 0.9,
     ["Debris dumped on the footpath", "Rubble pile blocking the walkway"], None),
    ("Yelahanka open burning", 13.1000, 77.6000, 400, [("open_burning", 4), ("garbage", 2)], 22, 35, "rising", 0.1,
     ["Garbage being burnt every evening near the lake", "Open burning of dry leaves and plastic, thick smoke"], None),
    ("Sarjapur Road emerging dumping", 12.9075, 77.6905, 420, [("plastic_waste", 3), ("garbage", 2), ("illegal_dumping", 1)], 9, 18, "rising", 0.0,
     ["Plastic waste piling up near the new apartments", "Someone dumped bags of garbage on the vacant plot"], None),
    ("Hennur emerging waterlogging", 13.0330, 77.6420, 420, [("waterlogging", 3), ("drainage", 2)], 8, 16, "rising", 0.0,
     ["Water stagnating on the main road after rain", "Drain blocked near the junction"], None),
    ("Jayanagar (well managed)", 12.9280, 77.5900, 600, [("garbage", 2), ("noise_pollution", 1), ("tree_loss", 1)], 16, 70, "falling", 0.85,
     ["Bin overflowing at the corner", "Fallen tree branch on the road"], (60, 72)),
]


SITES_OVERRIDE = {"Sarjapur Road emerging dumping": 1, "Hennur emerging waterlogging": 1}


def _offset(lat: float, lon: float, spread_m: float) -> tuple[float, float]:
    r = spread_m * math.sqrt(rng.random())
    a = rng.random() * 2 * math.pi
    return lat + r * math.sin(a) / 111_320, lon + r * math.cos(a) / (111_320 * math.cos(math.radians(lat)))


def _times(n: int, days: int, trend: str, now: datetime) -> list[datetime]:
    out = []
    for _ in range(n):
        u = rng.random()
        # rising: density increases toward now; falling: concentrated in the past
        x = u ** 0.55 if trend == "rising" else (1 - (1 - u) ** 0.55 if trend == "falling" else u)
        age_days = days * (1 - x)
        hour = rng.choice([7, 8, 9, 10, 12, 17, 18, 19, 20, 21, 22, 23])
        t = now - timedelta(days=age_days)
        out.append(t.replace(hour=hour, minute=rng.randint(0, 59)) if t.replace(hour=hour) < now else t)
    return sorted(out)


async def reset(db) -> None:
    await db.execute(
        text(
            """TRUNCATE drive_participants, cleanup_drives, points_ledger, notifications, verifications, incident_events, assignments, resolution_updates,
               media, reports, interventions, recommendations, incidents, hotspots, environmental_scores, external_data,
               grid_cells, green_zones, sensitive_sites, waste_points, locations, refresh_tokens, audit_logs, users, categories
               RESTART IDENTITY CASCADE"""
        )
    )
    await db.commit()


async def seed_reference(db) -> None:
    for i, (slug, label, domain, sev, weight, persistence) in enumerate(CATEGORIES):
        await db.execute(
            text(
                """INSERT INTO categories (slug, label, domain, default_severity, hazard_weight, persistence_days, sort_order)
                   VALUES (:s,:l,:d,:sev,:w,:p,:o)
                   ON CONFLICT (slug) DO UPDATE SET label=:l, domain=:d, default_severity=:sev, hazard_weight=:w, persistence_days=:p, sort_order=:o"""
            ),
            {"s": slug, "l": label, "d": domain, "sev": sev, "w": weight, "p": persistence, "o": i},
        )
    # Neighbourhood polygons: Voronoi cells of the (real) centres inside a buffered hull. Synthetic boundaries.
    await db.execute(text("CREATE TEMP TABLE seeds (name text, slug text, pop int, sens float, pt geometry) ON COMMIT DROP"))
    for name, lat, lon, pop, sens in NEIGHBORHOODS:
        await db.execute(
            text("INSERT INTO seeds VALUES (:n, :s, :p, :sens, ST_SetSRID(ST_MakePoint(:x,:y),4326))"),
            {"n": name, "s": name.lower().replace(" ", "-"), "p": pop, "sens": sens, "x": lon, "y": lat},
        )
    await db.execute(
        text(
            """
            WITH hull AS (SELECT ST_Buffer(ST_ConvexHull(ST_Collect(pt))::geography, 2500)::geometry g FROM seeds),
                 cells AS (SELECT (ST_Dump(ST_VoronoiPolygons(ST_Collect(pt), 0, (SELECT g FROM hull)))).geom g FROM seeds)
            INSERT INTO locations (slug, name, kind, geom, centroid, area_km2, population, population_source, sensitivity, properties, is_demo)
            SELECT s.slug, s.name, 'neighborhood', ST_Multi(ST_Intersection(c.g, h.g)), s.pt,
                   ST_Area(ST_Intersection(c.g, h.g)::geography) / 1e6, s.pop, 'demo-estimate', s.sens,
                   jsonb_build_object('boundary', 'synthetic (Voronoi of neighbourhood centres)'), true
            FROM cells c JOIN seeds s ON ST_Contains(c.g, s.pt) CROSS JOIN hull h
            """
        )
    )
    await db.commit()


async def seed_users(db) -> list[uuid.UUID]:
    pw = hash_password(DEMO_PASSWORD)
    for email, name, role, team in STAFF:
        db.add(User(email=email, display_name=name, role=role, team=team, password_hash=pw, is_demo=True))
    db.add(
        User(email="citizen@ecopulse.dev", display_name="Priya Nair", role="citizen", password_hash=pw, is_demo=True,
             home_location=wkt_point(77.6230, 12.9360))
    )
    first = ["Arjun", "Kavya", "Rohan", "Sneha", "Aditya", "Divya", "Karthik", "Ananya", "Nikhil", "Pooja", "Siddharth", "Lakshmi",
             "Imran", "Neha", "Varun", "Shreya", "Manoj", "Deepa", "Rahul", "Aisha"]
    ids = []
    for i in range(60):
        u = User(display_name=f"{first[i % len(first)]} {chr(65 + i % 26)}.", role="citizen", is_demo=True, email=None)
        lat, lon = NEIGHBORHOODS[i % len(NEIGHBORHOODS)][1:3]
        u.home_location = wkt_point(lon + rng.uniform(-0.01, 0.01), lat + rng.uniform(-0.01, 0.01))
        db.add(u)
        await db.flush()
        ids.append(u.id)
    await db.commit()
    return ids


async def seed_reports(db, citizen_ids: list[uuid.UUID]) -> int:
    now = datetime.now(UTC)
    planned = []
    for story in STORIES:
        name, lat, lon, spread, cats, n, days, trend, _res, descs, noise = story
        pool = [c for c, w in cats for _ in range(w)]
        # A storyline is a handful of concrete problem sites (a pile, an outfall, a junction)
        # that many citizens report; each report carries ~25 m of GPS jitter.
        n_sites = SITES_OVERRIDE.get(name, max(2, n // 7))
        sites = [(*_offset(lat, lon, spread), rng.choice(pool)) for _ in range(n_sites)]
        site_weights = [1 / (i + 1) ** 0.8 for i in range(n_sites)]
        for t in _times(n, days, trend, now):
            slat, slon, scat = rng.choices(sites, site_weights)[0]
            category = scat if rng.random() < 0.85 else rng.choice(pool)
            planned.append((t, story, category, *_offset(slat, slon, 25), descs, noise))
    # Background: scattered low-volume reports across the whole city
    background = ["garbage", "garbage", "plastic_waste", "drainage", "noise_pollution", "tree_loss", "waterlogging", "construction_dust", "sewage", "other"]
    for _ in range(160):
        name, lat, lon, *_ = rng.choice(NEIGHBORHOODS)
        t = now - timedelta(days=rng.random() * 80, hours=rng.random() * 12)
        planned.append((t, None, rng.choice(background), *_offset(lat, lon, 1400), None, (55, 78)))
    planned.sort(key=lambda p: p[0])

    count = 0
    for t, _story, category, plat, plon, descs, noise in planned:
        desc = rng.choice(descs) if descs and rng.random() < 0.8 else None
        r = Report(
            id=uuid.uuid4(),
            user_id=rng.choice(citizen_ids),
            category=category,
            description=desc,
            geom=wkt_point(plon, plat),
            accuracy_m=rng.choice([8, 12, 15, 20, 35]),
            h3=cell(plat, plon),
            noise_db=round(rng.uniform(*noise), 1) if noise and category == "noise_pollution" else None,
            captured_at=t,
            created_at=t,
            status="received",
            is_anonymous=rng.random() < 0.15,
            is_demo=True,
        )
        db.add(r)
        await db.commit()
        await process_report(str(r.id), emit=False)
        count += 1
        if count % 100 == 0:
            log.info("  processed %d / %d reports", count, len(planned))
    # Mark everything created from demo reports as demo, and backdate pipeline events.
    await db.execute(text("UPDATE incidents SET is_demo = true WHERE id IN (SELECT incident_id FROM reports WHERE is_demo)"))
    await db.execute(
        text(
            """UPDATE incident_events e SET created_at = r.created_at FROM reports r
               WHERE e.data->>'data_report' = r.id::text"""
        )
    )
    await db.execute(
        text(
            """UPDATE incident_events e SET created_at = i.last_reported_at + interval '5 minutes' FROM incidents i
               WHERE e.incident_id = i.id AND e.created_at > now() - interval '1 hour' AND e.data->>'data_report' IS NULL"""
        )
    )
    await db.execute(
        text(
            """UPDATE incident_events e SET created_at = i.first_reported_at + interval '1 minute' FROM incidents i
               WHERE e.incident_id = i.id AND e.kind = 'ai_classified'"""
        )
    )
    await db.commit()
    return count


async def seed_lifecycle(db, citizen_ids: list[uuid.UUID]) -> None:
    """Move older demo incidents through assignment / action / resolution, with verifications."""
    now = datetime.now(UTC)
    officers = {u.team: u for u in (await db.execute(select(User).where(User.role == "officer"))).scalars()}
    moderator = (await db.execute(select(User).where(User.role == "moderator"))).scalar_one()
    incidents = (await db.execute(select(Incident).where(Incident.is_demo))).scalars().all()
    resolve_share = {}
    for story in STORIES:
        resolve_share[(round(story[1], 2), round(story[2], 2))] = story[8]

    for inc in incidents:
        age = (now - inc.first_reported_at).days
        lon, lat = (await db.execute(text("SELECT ST_X(geom), ST_Y(geom) FROM incidents WHERE id=:i"), {"i": inc.id})).one()
        share = 0.5  # background reports: typical ward-office follow-through
        for (slat, slon), s in resolve_share.items():
            if abs(slat - lat) < 0.008 and abs(slon - lon) < 0.008:
                share = s
                break
        # Authorities act while reports keep arriving; resolution only lands once reports go quiet.
        quiet_days = (now - inc.last_reported_at).total_seconds() / 86400
        t = inc.first_reported_at + timedelta(hours=rng.randint(2, 30))
        if t >= now:
            continue
        team = TEAMS.get(inc.domain, "Ward Office")
        officer = officers.get(team) or next(iter(officers.values()))

        def ev(kind: str, to_status: str | None, when: datetime, actor=None, note=None, **data):
            db.add(IncidentEvent(incident_id=inc.id, kind=kind, from_status=inc.status if to_status else None, to_status=to_status,
                                 actor_id=actor, note=note, data=data, created_at=when))
            if to_status:
                inc.status = to_status

        if inc.status in ("reported", "ai_classified") and (inc.reporter_count >= 2 or rng.random() < 0.7) and age >= 1:
            ev("moderator_verified", "verified", t, moderator.id, "Photo and location checked")
            ev("prioritized", "prioritized", t + timedelta(minutes=1), priority=inc.priority)
            t += timedelta(hours=rng.randint(3, 20))
        if inc.status == "prioritized" and age >= 2 and rng.random() < 0.8 and t < now:
            ev("assigned", "assigned", t, officer.id, None, team=team)
            inc.assigned_team, inc.assignee_id = team, officer.id
            t += timedelta(hours=rng.randint(6, 48))
            if rng.random() < max(share, 0.35) + (0.3 if quiet_days > 5 else 0) and t < now:
                ev("action_started", "action_started", t, officer.id, "Crew dispatched")
                db.add(ResolutionUpdate(incident_id=inc.id, author_id=officer.id, status="action_started", note="Crew dispatched", created_at=t))
                t = max(t + timedelta(hours=rng.randint(6, 72)), inc.last_reported_at + timedelta(hours=rng.randint(2, 24)))
                if t < now - timedelta(hours=6) and rng.random() < share + (0.45 if quiet_days > 6 else 0):
                    note = {
                        "waste": "Area cleared and waste transported to the processing facility.",
                        "water": "Outfall blocked and lake edge cleaned; water samples sent for testing.",
                        "air": "Site owner fined and dust screens installed.",
                        "noise": "Venue warned; sound limiter enforced.",
                        "flood": "Drain desilted and inlets cleared.",
                        "green": "Felling stopped; replanting ordered.",
                    }.get(inc.domain, "Issue addressed by ward office.")
                    ev("resolved", "resolved", t, officer.id, note, has_after_photo=False)
                    inc.resolved_at = t
                    db.add(ResolutionUpdate(incident_id=inc.id, author_id=officer.id, status="resolved", note=note, created_at=t))
                    votes = [rng.choices(["no", "yes", "unsure"], [8, 1, 1])[0] for _ in range(rng.randint(0, 9))]
                    for v, resp in zip(rng.sample(citizen_ids, k=len(votes)), votes):
                        db.add(Verification(incident_id=inc.id, user_id=v, response=resp, phase="resolution",
                                            created_at=min(now, t + timedelta(hours=rng.randint(4, 72)))))
                    confirmations = votes.count("no")
                    if confirmations >= 3 and confirmations > 2 * votes.count("yes") and t + timedelta(days=2) < now:
                        ev("citizen_verified", "citizen_verified", t + timedelta(days=2), note=f"{confirmations} citizens confirmed the fix")
        # Active-phase verification votes on open incidents
        if inc.status not in ("resolved", "citizen_verified"):
            for v in rng.sample(citizen_ids, k=rng.randint(0, 6)):
                resp = rng.choices(["yes", "no", "unsure"], [7, 1, 1])[0]
                db.add(Verification(incident_id=inc.id, user_id=v, response=resp, phase="active", created_at=inc.last_reported_at))
        await db.flush()
        counts = dict(
            (await db.execute(
                text("SELECT response, count(*) FROM verifications WHERE incident_id=:i AND phase = :p GROUP BY response"),
                {"i": inc.id, "p": "resolution" if inc.status in ("resolved", "citizen_verified") else "active"},
            )).all()
        )
        inc.verify_yes, inc.verify_no, inc.verify_unsure = counts.get("yes", 0), counts.get("no", 0), counts.get("unsure", 0)
    await db.commit()


DRIVE_NOTES = [
    "Cleared the whole stretch. The corner bin is still missing, so it may pile up again.",
    "Great turnout! Segregated plastic separately for the recycler.",
    "Most of it is gone; construction debris was too heavy for us and needs a truck.",
]


async def seed_drives(db) -> int:
    """A few community clean-up drives: some done (with results), some coming up."""
    from app.modules.incidents.service import add_event
    from app.modules.notifications.service import award

    if await db.scalar(text("SELECT count(*) FROM cleanup_drives WHERE is_demo")):
        return 0
    now = datetime.now(UTC)
    targets = (
        await db.execute(
            select(Incident)
            .where(Incident.domain.in_(["waste", "water"]), Incident.status.in_(["prioritized", "assigned", "action_started", "verified"]))
            .order_by(Incident.reporter_count.desc())
            .limit(6)
        )
    ).scalars().all()
    priya = await db.scalar(select(User.id).where(User.email == "citizen@ecopulse.dev"))
    citizens = list((await db.execute(select(User.id).where(User.role == "citizen", User.email.is_(None), User.is_demo))).scalars())
    if not targets or not citizens:
        return 0
    n = 0
    for i, inc in enumerate(targets):
        past = i % 2 == 1
        day = now.date() + timedelta(days=-rng.randint(4, 24) if past else rng.randint(1, 9))
        # 7:30 or 8:00 local (IST, UTC+5:30) morning start.
        starts = datetime(day.year, day.month, day.day, 2, rng.choice([0, 30]), tzinfo=UTC)
        organizer = priya if i == 0 else rng.choice(citizens)
        crowd = rng.sample(citizens, rng.randint(3, 14))
        d = CleanupDrive(
            title=f"Clean-up: {inc.title}",
            description="Meet at the spot. Gloves and bags provided; bring water." if not past else None,
            starts_at=starts, duration_min=rng.choice([90, 120, 180]), geom=inc.public_geom, location_id=inc.location_id,
            incident_id=inc.id, hotspot_id=inc.hotspot_id, organizer_id=organizer,
            max_volunteers=rng.choice([None, 20, 25]), is_demo=True, created_at=starts - timedelta(days=rng.randint(3, 8)),
        )
        db.add(d)
        await db.flush()
        people = {organizer, *crowd}
        for uid in people:
            db.add(DriveParticipant(drive_id=d.id, user_id=uid, created_at=d.created_at + timedelta(hours=rng.randint(1, 48))))
        await add_event(db, inc, "cleanup_scheduled", actor_id=organizer, note=d.title, drive_id=str(d.id))
        if past:
            d.status, d.completed_at = "completed", starts + timedelta(minutes=d.duration_min + 30)
            d.attended = max(2, len(people) - rng.randint(0, 3))
            d.bags_collected = rng.randint(2, 4) * d.attended
            d.outcome_note = DRIVE_NOTES[i // 2 % len(DRIVE_NOTES)]
            await add_event(db, inc, "cleanup_completed", actor_id=organizer, note=d.outcome_note, drive_id=str(d.id),
                            bags=d.bags_collected, volunteers=d.attended)
            for uid in people:
                await award(db, uid, "drive_completed", str(d.id), ref_type="drive")
            await award(db, organizer, "drive_organized", str(d.id), ref_type="drive")
        await db.flush()
        # Timeline events default to now(); place them when they would have happened.
        await db.execute(
            text("""UPDATE incident_events SET created_at = CASE kind WHEN 'cleanup_scheduled' THEN CAST(:c AS timestamptz) ELSE CAST(:done AS timestamptz) END
                    WHERE incident_id = :i AND data->>'drive_id' = :d"""),
            {"c": d.created_at, "done": d.completed_at or d.created_at, "i": inc.id, "d": str(d.id)},
        )
        n += 1
    await db.commit()
    return n


async def recompute_all(db) -> None:
    from app.modules.incidents.service import confidence_from, recompute_risk

    for inc in (await db.execute(select(Incident))).scalars().all():
        inc.confidence = confidence_from(inc)
        await recompute_risk(db, inc)
    await db.commit()


async def main(do_reset: bool, drives_only: bool = False) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    async with SessionLocal() as db:
        if drives_only:
            log.info("clean-up drives: %s", await seed_drives(db))
            return
        if do_reset:
            log.info("resetting database")
            await reset(db)
        if await db.scalar(text("SELECT count(*) FROM locations")):
            log.info("database already seeded; use --reset to start over")
            return
        log.info("reference data and synthetic neighbourhood boundaries")
        await seed_reference(db)
        log.info("geodata (OpenStreetMap, demo fallback)")
        log.info("  %s", await external.load_geodata(db, CITY_BBOX))
        log.info("H3 grid")
        await gridlib.build_grid(db)
        log.info("  elevation: %s", await external.load_elevation(db))
        log.info("  external conditions: %s", await external.refresh_conditions(db))
        log.info("users")
        citizens = await seed_users(db)
        log.info("synthetic reports through the live pipeline")
        n = await seed_reports(db, citizens)
        log.info("  %d reports", n)
        log.info("lifecycle progression")
        await seed_lifecycle(db, citizens)
        await recompute_all(db)
        log.info("hotspots: %s", await hotspots.detect(db, emit=False))
        log.info("grid: %s", await gridlib.refresh_grid(db))
        log.info("scores: %s locations", await scores.recompute(db, emit=False))
        log.info("recommendations: %s", await recommendations.generate(db))
        log.info("clean-up drives: %s", await seed_drives(db))
        await scores.recompute(db, emit=False)
        log.info("done. Staff logins use password %r (development only).", DEMO_PASSWORD)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--drives", action="store_true", help="only add demo clean-up drives")
    args = parser.parse_args()
    asyncio.run(main(args.reset, args.drives))
