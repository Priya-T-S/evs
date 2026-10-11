# EcoPulse

**Real-time environmental intelligence and civic action, as pure software.**
EcoPulse turns citizen reports, open environmental data and geospatial analysis into
incidents, hotspots, transparent risk scores, neighbourhood scores, forecasts and
intervention recommendations. It needs no hardware: only the phone a citizen already has
(GPS, camera, microphone), a browser, and a backend.

```
apps/mobile      Citizen app — React + TypeScript + Capacitor
apps/web         City Environmental Command Center — React + TypeScript (desktop)
packages/core    Shared contract: API + realtime clients, types, design tokens, MapLibre GIS engine
backend          FastAPI modular monolith + PostgreSQL/PostGIS + Redis + background worker
```

---

## Quick start (no coding needed, Windows)

1. Install **Python 3.12** (python.org; tick "Add to PATH") and **Node.js LTS** (nodejs.org).
2. Double-click **`setup.bat`**. This is a one-time step of about 5–10 minutes and needs internet. It installs the database and loads a demo city.
3. Double-click **`start.bat`**. EcoPulse opens in your browser:
   - **Citizen app** at http://localhost:5174. Tap *Continue as guest*.
   - **Command center** (for city staff) at http://localhost:5173. Sign in with `officer@ecopulse.dev`, password `ecopulse-demo`.
4. When you're done, double-click **`stop.bat`**.

If something goes wrong, the scripts say what to do. Logs are in the `.logs` folder.

---

## Running it (developers)

**Requirements:** Python 3.12, Node 20+, pnpm 10, PostgreSQL 16+ with PostGIS 3, Redis (optional).

The quickest route is Docker for infrastructure:

```bash
docker compose up -d db redis          # PostGIS + Redis (MinIO too if you want S3 media)
```

Backend:

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate        # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env                                  # with docker compose: ECOPULSE_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/ecopulse
alembic upgrade head                                  # schema (creates the postgis extension)
python -m app.seed.run                                # demo dataset (~2 min; fetches OpenStreetMap + Open-Meteo)
uvicorn app.main:app --reload --port 8000             # API + embedded worker; docs at /docs
```

Frontends (from the repo root):

```bash
pnpm install
pnpm dev:web        # command center  → http://localhost:5173
pnpm dev:mobile     # citizen app     → http://localhost:5174 (use a phone-sized window)
```

Native mobile builds: `cd apps/mobile && pnpm build && npx cap add android && npx cap sync` (needs
Android Studio / Xcode). Point the app at your machine's LAN address with `VITE_API_URL`.

**Demo accounts** (development only, password `ecopulse-demo`): `admin@ecopulse.dev`,
`officer@ecopulse.dev`, `officer.water@ecopulse.dev`, `analyst@ecopulse.dev`,
`moderator@ecopulse.dev`, `citizen@ecopulse.dev`. Citizens can also continue as a guest.

**Tests:** `cd backend && pytest` (26 unit + integration tests; integration tests use the seeded
DB) and `python tests/e2e_realtime.py` against a running API (report → pipeline → WebSocket).

### Optional integrations

| Setting | Effect when set | Without it |
|---|---|---|
| `ECOPULSE_ANTHROPIC_API_KEY` | Photo classification uses Claude vision; the assistant uses Claude with tool use over EcoPulse data | Transparent local heuristic classifier and a deterministic intent router (same data tools) |
| `ECOPULSE_REDIS_URL` | Cross-process event bus, job queue, rate limits | In-process equivalents (single process) |
| `ECOPULSE_STORAGE_BACKEND=s3` + S3 vars | Media in any S3-compatible store with presigned URLs | Local filesystem under `backend/media` |
| `ECOPULSE_EXTERNAL_DATA_ENABLED=false` | — | Forces labelled demo providers |

Open-Meteo (air quality, weather, elevation) and OpenStreetMap/Overpass (parks, schools,
hospitals, waste points) need no keys. If a provider is unreachable, EcoPulse keeps working with
clearly labelled demo data and retries later (Overpass responses are cached for 30 days).

### What's in each app

**Command center (`apps/web`, dark by default, light toggle).**
- **Main screen:** a live priority queue (P1–P4 ranked by risk) beside a map that fills the rest of the screen, with a detail drawer on the right.
- **Detail drawer:**
  - Lifecycle stepper.
  - Data-trust block that keeps Observed, External, Model and Recommendation separate.
  - Evidence with before/after photos.
  - Timeline.
  - Verify / assign / start / resolve, including an after-photo upload.
- **Other screens:**
  - Hotspots, including forecast hotspots.
  - Recommendations and interventions tracking.
  - Analytics.
  - The grounded assistant.
  - Admin: users and roles, audit log, data-source health, job triggers.

**Citizen app (`apps/mobile`).** Home · Map · Report · Pulse · Profile.
- **Reporting:** a 4-step report flow that takes under 20 seconds:
  - category,
  - photo with an AI preview,
  - GPS position with a draggable pin,
  - optional details.
- **Noise meter:** processed on the phone; only the dB number is sent.
- **Offline queue:** reports are saved in IndexedDB and uploaded with retries (safe to resend).
- **Map:** full screen, with bottom sheets for details and Yes/No/Unsure community verification.
- **Pulse:** live city feed.
- **Profile:** EcoPoints and level, my reports, notification preferences, privacy, and the status of each data source.
- **Accounts:** a guest who registers keeps their reports and points.

Both apps share `packages/core`, including the `EcoMapController` GIS engine, so map behaviour is identical in both. Screenshot and review scripts are in `apps/web/scripts/shots.mjs`, `apps/mobile/scripts/shots.mjs` and `scripts/gis-review.mjs`. They rely on dev-only `window.__ep*` hooks that are left out of production builds.

---

## Architecture

```
 Citizen app (Capacitor)      Command center (web)
          │   REST + WebSocket (geographic subscriptions)
          └──────────────┬──────────────┘
                   FastAPI modular monolith
   auth · reports · incidents · maps · hotspots · scores · pulse · recommendations
   analytics · notifications · external_data · assistant · users
          │                  │                     │
  PostgreSQL + PostGIS     Redis               Media storage
  (GIST indexes, H3 grid)  pub/sub · jobs ·    (local / S3, EXIF-stripped,
                           rate limits          thumbnails)
                             │
                      Background worker
     report pipeline · hotspot engine · grid + flood model · scores · recommendations
     external data refresh · area/flood alerts
```

* **Modular monolith** (`backend/app/modules/*`): one deployable, clear module boundaries.
  The worker runs inside the API in development or as `python -m app.worker` in production.
* **Realtime path:** `POST /reports` (202, ~300 ms) → job queue → worker classifies,
  de-duplicates, creates/merges the incident and scores it → event published to Redis
  `ecopulse:events` → every API process forwards it to its WebSocket clients whose viewport
  bbox / topics match → clients update map, queue, pulse and stats in place. Area refreshes
  (hotspots, grid, scores) are debounced so a burst of reports causes one recompute.
* **Privacy:** exact report coordinates are only visible to the reporter and staff. Public APIs
  and every realtime event use a deterministic ~120 m grid snap (same input ⇒ same output, so
  repeated queries cannot be averaged). Photos are re-encoded (EXIF/GPS removed). Noise is
  measured on the phone; only the dB number is uploaded. Anonymous reporting hides the
  reporter from staff too. Rate limits on auth, reports, verification, classification and the
  assistant; audit log for every state change.
* **Security:** JWT access tokens + rotating refresh tokens with reuse detection (reuse
  revokes the whole token family), permission-based RBAC (citizen, moderator, analyst,
  officer, admin), validated input everywhere, image upload validation (type, size, pixel
  count, decode check), consistent error envelope `{"error": {"code", "message", "details"}}`.

### Data model (PostGIS, SRID 4326)

`users`, `refresh_tokens`, `audit_logs`, `points_ledger`, `categories`, `locations`
(neighbourhood polygons), `reports` (exact point, protected), `media`, `incidents` (exact +
public point), `incident_events` (immutable timeline), `verifications`, `assignments`,
`resolution_updates`, `hotspots` (polygons, observed or predicted), `grid_cells` (H3 r8
analytic grid), `environmental_scores` (history), `recommendations`, `interventions`,
`notifications`, `external_data`, `green_zones`, `sensitive_sites`, `waste_points`.
Spatial columns have GIST indexes; distance queries use `geography`. Schema is managed with
Alembic (`backend/alembic`).

---

## Intelligence (all models are transparent; every output stores its inputs)

| Model | What it does |
|---|---|
| **Classification** (`app/ai/classifier.py`) | Claude vision with a JSON schema when a key is configured; otherwise `heuristic-v1`: keyword lexicon + image colour statistics, confidence capped at 0.72 and labelled as heuristic. Never overrides the citizen's category; strong disagreement is flagged and offered as a one-tap switch. |
| **Duplicate detection** (`reports/pipeline.py`) | Spatial (radius from GPS accuracy) 0.35 · category 0.25 · time window 0.15 · image dHash 0.15 · text similarity 0.10, renormalised over available signals; merge at ≥ 0.62. "N citizens reported this" comes from merged reports. |
| **Incident risk `risk-1`** | 100 · Σ wᵢcᵢ over severity, independent reporters, people exposed (500 m), persistence, schools/hospitals within 300 m, 72-h velocity, external signal (AQI / rain). Contributions are stored and shown. P1 ≥ 80, P2 ≥ 60, P3 ≥ 35. |
| **Hotspots `hotspot-1`** | Weighted DBSCAN (haversine, 350 m) per domain with stable identity across recomputes; active → cooling → resolved. Forecast hotspots: 8-week per-cell linear trend, labelled as predictions with confidence. |
| **Environmental Pulse `pulse-1`** | Per neighbourhood: air (60 % AQI, 40 % reports), water, waste, noise (+ measured dB), green (OSM green share), clean-up (resolution share and speed). Weighted overall. |
| **Grid + flood `grid-1` / `flood-1`** | H3 r8 risk surface; predicted flood = (0.25 + 0.75·rain) × (low-lying + history + drainage + impervious). Observed flooding (citizen reports, 72 h) is stored and drawn separately. |
| **Recommendations `rec-1`** | Hotspot playbooks, greedy max-coverage waste-collection siting, green corridors between OSM green areas, flood preparedness, silence zones. Each separates **observed**, **inference** and **actions**. |
| **Assistant** | Claude tool-use loop (or the local intent router) over six data tools; answers cite provenance and include the tool calls made. |

---

## API (selected)

```
POST /auth/register | /auth/login | /auth/guest | /auth/refresh | /auth/logout     GET|PATCH /auth/me
POST /reports (multipart, idempotent on client_id)   GET /reports   GET /reports/{id}   POST /ai/classify
GET  /incidents   GET /incidents/{id}
POST /incidents/{id}/verify | /moderate | /assign | /start | /resolve (multipart, after photo)
GET  /hotspots (json|geojson)   GET /hotspots/{id}
GET  /map/layers | /map/incidents (zoom-adaptive) | /map/heatmap | /map/grid | /map/locations
     /map/green-zones | /map/waste-points | /map/sensitive-sites | /map/aqi | /map/recommendations | /map/search
GET  /environmental-score?lat&lon | ?location_id   /environmental-score/locations   /{id}/history
GET  /pulse   GET /recommendations   POST /recommendations/{id}/decision   GET|PATCH /interventions
GET  /analytics/overview   GET /notifications   POST /assistant/ask   GET /external-data/status
GET  /users   PATCH /users/{id}   GET /audit-logs   POST /admin/jobs/{regenerate|refresh_external}
WS   /ws?token=…   → {"type":"subscribe","topics":[…],"bbox":[w,s,e,n]}
     events: incident.created|updated|resolved, hotspot.created|updated|cooled,
             environmental_score.updated, alert.created, notification.created
```

Full interactive documentation: `http://localhost:8000/docs`.

---

## Data honesty

* Neighbourhood names and centres are real; **boundaries are synthetic** (Voronoi) and
  **population figures are demo estimates**. Both are flagged in the API and UI.
* The seeded incidents and reports are **synthetic** (`is_demo = true`) but run through the
  real pipeline. AQI, weather, elevation and OSM features are **live** when reachable.
* Satellite NDVI is not configured (needs imagery credentials); nothing is fabricated in its
  place. Green cover uses OpenStreetMap areas.
