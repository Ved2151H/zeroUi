# Zero UI — Developer Guide

Everything you need to understand, run, and extend this project. Verified against
the current checkout (backend booted, 24/24 tests passing, full emergency
pipeline exercised via the simulator).

---

## 1. What this project is

A **Zero-UI emergency response system**. The user never opens an app or presses
a button:

1. The phone watches the accelerometer for **free-fall → impact → stillness**.
2. On detection it runs a **15 s countdown** with heavy vibration.
3. If the user does nothing, the phone opens a **live emergency session** and
   streams to an **authority dashboard**: GPS every 30 s, DigiPIN, sensor
   telemetry, an event timeline, ~60 s audio segments, and (on demand) live
   audio.
4. Entering the **safety PIN** during the countdown cancels everything and
   creates *nothing* on the backend — no record, no socket, no dashboard entry.

> **Key design invariant:** every emergency is a UUID `emergency_id`, and every
> child row (event, location, audio segment), every socket, and every audio
> asset is keyed by it. Cross-emergency leakage is structurally impossible, and
> a DB-level partial unique index enforces **one active emergency per user**.

---

## 2. What the project currently has (platform support)

| Component | Path | Technology | Status |
| --- | --- | --- | --- |
| **Android app** | `mobile-app/` | Flutter 3.41 / Dart 3 + Kotlin | Real, buildable. Package `com.zeroui.app`, minSdk 24. **Android only** — no iOS target wired up |
| **Backend** | `backend/` | FastAPI 0.115 + uvicorn 0.30 + SQLite (aiosqlite) | Complete; also serves the two web frontends |
| **Authority dashboard** | `dashboard/` | Vanilla JS + Leaflet 1.9 + OSM tiles. **No build step** | Complete. Served at `/dashboard/` |
| **Browser phone** | `mobile-simulator/` | Vanilla JS | Complete. Served at `/mobile/`. Mirrors the Android flow for demos/E2E without a device |
| **iOS app** | — | — | ❌ Does not exist |
| **Desktop app** | — | — | ❌ Does not exist |
| **Native web app (React/Vue)** | — | — | ❌ Does not exist — dashboard and mobile-simulator are plain HTML/JS |

Both web frontends talk to the **same REST + WebSocket API** as the Android app.
There is no separate "web API".

**Deployment shape:** a single uvicorn process. The realtime hub is in-process
memory and the DB is a single SQLite file, so it is **single-worker by design**
(multi-worker would need Redis pub/sub to share the hub, and would break the
one-active-per-user race protection).

---

## 3. Running it (verified)

Prerequisites: Python 3.12. Flutter 3.41+ and Android SDK 34+ only if you want
the Android app.

### Single command (Recommended)

```bash
npm run dev
```

This single command handles Python/venv detection, dependency verification, clearing any previous stale instance on port 8000, and running Uvicorn with hot reload.

### Manual Python steps

```bash
# 1. dependencies (venv/ is committed but its pyvenv.cfg pointed at another
#    machine's interpreter — it has been repointed at the local Python 3.12.
#    If it breaks again, just delete venv/ and create a fresh one.)
venv/Scripts/python.exe -m pip install -r backend/requirements.txt      # Windows
./venv/bin/python -m pip install -r backend/requirements.txt            # macOS/Linux

# 2. run the backend (also serves the dashboard + browser phone)
cd backend
../venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

| URL | What |
| --- | --- |
| http://127.0.0.1:8000/dashboard/ | Authority console |
| http://127.0.0.1:8000/mobile/ | Browser phone simulator |
| http://127.0.0.1:8000/docs | OpenAPI explorer |
| http://127.0.0.1:8000/health | Health + realtime hub counters |

Dashboard sign-in token: `zeroui-dev-dashboard-token`.

**No migration step** — the schema is created/migrated automatically on start.

### Produce a live emergency without a phone

```bash
cd backend
../venv/Scripts/python.exe scripts/device_simulator.py --user demo_phone_001 --seconds 30 --keep-active
```

`device_simulator.py` is a **headless phone**: it enrolls, triggers, runs the
countdown, activates, pushes locations/telemetry/events, uploads a real WAV
segment, opens the real WebSocket channels and streams live PCM frames.

Flags: `--trigger {fall,manual,shake,test}`, `--lat/--lng`, `--seconds`,
`--segment-seconds`, `--keep-active`, `--cancel --pin 1234`,
`--resolve-only <emergency_id>`, `--base <url>`.

### Android app

```bash
cd mobile-app
flutter pub get
flutter run --dart-define=ZEROUI_API_BASE=http://10.0.2.2:8000        # emulator
flutter build apk --release --dart-define=ZEROUI_API_BASE=http://192.168.1.5:8000
```

---

## 4. Repository map

### `backend/` — FastAPI service (~5,600 LOC)

| File | Role |
| --- | --- |
| `main.py` | App assembly: lifespan (schema + migration), CORS, routers, PIN/contacts endpoints, `/health`, `/api/config`, exception handler, static mounts of `dashboard/` and `mobile-simulator/` |
| `config.py` | `Settings` — the single source of truth. Reads `backend/.env` via dotenv, exposes dev fallbacks, and **fails fast in `ZEROUI_ENV=production`** if the three secrets are still defaults |
| `security.py` | Device bearer tokens (SHA-256 hashed at rest), dashboard JWT sessions (HS256, 12 h), PIN hashing, `get_authority` / `get_device` / `verify_*_ws` dependencies |
| `database.py` | All persistence. `SCHEMA_STATEMENTS` (the DB DDL), `init_db()`, 35+ async query functions, row→dict mappers |
| `migrations.py` | One-time **in-place** migration of the original prototype schema (integer ids → UUID), renaming old tables to `legacy_*`, preserving events/locations/audio, mapping `safe`→`cancelled` |
| `models.py` | Pydantic request/response models with real validation (lat/lng bounds, ISO-8601 normalisation, `^[a-z0-9_]{1,48}$` event types, 4-digit PIN pattern) |
| `serializers.py` | One place deciding the API shape: `serialize_summary` / `serialize_detail` / `serialize_segment` / `serialize_location` / `serialize_event`. Derives `connection_state` (`live`/`stale`/`ended`), `duration_seconds`, and the `live_audio` block |
| `realtime.py` | `ConnectionManager` — the in-process fan-out hub: dashboard sockets, device sockets, live-audio producers and listeners, all keyed by `emergency_id` |
| `notify.py` | Message builders — every realtime frame goes through here so all dashboards get identically shaped payloads |
| `digipin_service.py` | India Post **DIGIPIN** via the real `digipin` PyPI package, plus `generate_digipin_with_reason()` so unavailability is explained, never faked |
| `streaming.py` | Byte-range (`Range: bytes=`) audio file serving — Starlette's `FileResponse` doesn't honour ranges, and `<audio>` seek needs them |
| `sms_service.py` | Optional Twilio alerting. Formats the alert SMS, normalises numbers to E.164, returns per-contact result dicts |
| `check_delivery.py` | Standalone helper: prints the delivery status of the last 5 Twilio messages |
| `routers/auth.py` | `POST /api/auth/dashboard/login`, `GET /api/auth/dashboard/session` |
| `routers/devices.py` | `POST /api/devices/register`, `GET /api/devices/config`, `GET /api/devices/me` |
| `routers/emergencies.py` | Device lifecycle: start, active, get, locations, telemetry, events, status, audio segments |
| `routers/dashboard.py` | Authority read API: snapshot, list, detail, events, locations, resolve, request-live-audio, audio, devices, stats, health |
| `routers/ws.py` | All three WebSocket endpoints and the device message dispatcher |
| `scripts/device_simulator.py` | The headless phone (also the best E2E smoke test) |
| `tests/` | `conftest.py` fixtures + 4 test modules (24 tests) |
| `.env.example` | Fully commented template of every setting |
| `requirements.txt` / `requirements-dev.txt` | Runtime deps / runtime + pytest 8.3.3 + httpx 0.27.2 |
| `data/` | **gitignored at runtime**: `emergencies.db` + `audio/{emergency_id}/segment_NNNN.wav` |

### `dashboard/` — authority console

`index.html` (markup + sign-in overlay) · `app.js` (state, rendering, realtime
handling — the big one) · `api.js` (REST + socket client, session, backoff) ·
`map.js` (Leaflet map, colour-coded markers, GPS track) · `audio.js` (live audio
playback + per-emergency segments) · `style.css` · `realtime.css` ·
`theme-light.css`. Scripts load in order: `api.js → map.js → audio.js → app.js`.

### `mobile-app/` — Flutter (~5,100 LOC Dart)

| File | Role |
| --- | --- |
| `lib/main.dart` | App shell, dark theme, phase router (`booting → onboarding → passive → countdown → active/recovered`), `_Splash` |
| `lib/emergency_controller.dart` | **The heart** (1,207 LOC) — the full state machine: initialize, restore identity, detect, countdown, activate, stream, cancel, resolve |
| `lib/sensors.dart` | Accelerometer fall detector: low-g free-fall → impact spike → post-impact stillness |
| `lib/api.dart` | REST client, persisted **offline outbox**, socket clients with backoff |
| `lib/audio.dart` | PCM16 mono 16 kHz capture → WAV packaging, ~60 s segments, live frames |
| `lib/telemetry.dart` | Location + device telemetry sampling |
| `lib/foreground.dart` | Bridge to the Kotlin foreground service |
| `lib/config.dart` | Build-time `--dart-define` values + runtime-persisted settings, plus fall-detection thresholds |
| `lib/models.dart` · `lib/widgets.dart` | Data models / shared UI |
| `lib/screens/` | `onboarding.dart` · `home.dart` · `countdown.dart` · `active.dart` · `settings.dart` |
| `android/.../MainActivity.kt` | Plugin registration, method channel |
| `android/.../EmergencyForegroundService.kt` | Keeps the session alive with the screen off |
| `android/.../PermissionBridge.kt` | Requests all runtime permissions in one place so onboarding can explain each first |
| `test/emergency_flow_test.dart` | Widget/unit tests |

### `mobile-simulator/` — browser phone

`index.html` · `device.js` (enrolment + device token) · `sensors.js`
(browser-motion fall detection) · `audio.js` (real mic capture, synthetic
fallback) · `emergency.js` (countdown + session) · `app.js` (UI wiring) ·
`style.css`. Scripts load: `device.js → sensors.js → audio.js → emergency.js →
app.js`.

### Root

`README.md` (user-facing, excellent) · `DIAGRAMS.md` (19 sections of Mermaid
diagrams: architecture, state machines, fall-detection pipeline, audio pipeline,
ER diagram, deployment topology, failure modes) · `venv/` · `.env` (gitignored,
**contains live Twilio credentials** — see §11).

---

## 5. Emergency lifecycle & state machines

```
IDLE ──(impact + stillness, or manual SOS)──▶ COUNTDOWN (15 s, cancelable)
                                                 │                 │
                              "I'm safe" + PIN ──┘                 │ timeout
                                     │                             ▼
                                     ▼                        EMERGENCY
                              nothing is sent              • GPS every 30 s
                              no record created            • DIGIPIN per fix
                                                           • ~60 s audio segments
                                                           • live audio stream
                                                           • event timeline
                                                             │            │
                                              resolve ◀──────┘            └──────▶ cancel (PIN)
```

**Server statuses:** `emergency`, `verifying` (reserved, unused by default),
`cancelled`, `resolved`.
**Dashboard connection states (derived, not stored):** `live` (update within
`ZEROUI_STALE_AFTER_SECONDS`) · `stale` · `ended`.

---

## 6. Configuration — every environment variable

Read from `backend/.env` (gitignored). All have development defaults so the
prototype runs with zero setup.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ZEROUI_ENV` | `development` | `production` makes the 3 secrets mandatory + CORS explicit, else startup raises |
| `ZEROUI_LOG_LEVEL` | `INFO` | Log level |
| `ZEROUI_HOST` / `ZEROUI_PORT` | `0.0.0.0` / `8000` | Bind address |
| `ZEROUI_DASHBOARD_TOKEN` | `zeroui-dev-dashboard-token` | Authority sign-in |
| `ZEROUI_ENROLLMENT_TOKEN` | `zeroui-dev-enroll-token` | Phone enrolment |
| `ZEROUI_JWT_SECRET` | dev default | Signs dashboard sessions **and salts PIN hashes** |
| `ZEROUI_DASHBOARD_SESSION_MINUTES` | `720` | Session lifetime |
| `ZEROUI_DATA_DIR` | `backend/data` | Root for DB + audio |
| `ZEROUI_DB_PATH` | `<data>/emergencies.db` | SQLite file |
| `ZEROUI_AUDIO_DIR` | `<data>/audio` | Audio storage |
| `ZEROUI_COUNTDOWN_SECONDS` | `15` | On-device cancel window |
| `ZEROUI_LOCATION_INTERVAL_SECONDS` | `30` | Location cadence |
| `ZEROUI_AUDIO_SEGMENT_SECONDS` | `60` | Segment length |
| `ZEROUI_STALE_AFTER_SECONDS` | `90` | Stale threshold |
| `ZEROUI_MAX_AUDIO_SEGMENT_BYTES` | `26214400` | 25 MB upload cap |
| `ZEROUI_MAX_LIVE_FRAME_BYTES` | `65536` | Live frame cap (oversized frames dropped, throttled warning) |
| `ZEROUI_CORS_ORIGINS` | `*` | Comma-separated; must be explicit in production |
| `ZEROUI_DASHBOARD_URL` | empty | Public dashboard link embedded in the alert SMS |
| `TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_PHONE_NUMBER` | empty | Optional SMS; unset → logs `sms skipped` |

The app also reads `--dart-define=ZEROUI_API_BASE` and
`--dart-define=ZEROUI_ENROLLMENT_TOKEN` at build time, both overridable at
runtime in the in-app Settings screen. Devices pull live parameters from
`GET /api/config`, so changing the countdown/intervals server-side changes device
behaviour **without rebuilding the app**.

---

## 7. Data model (SQLite, WAL mode)

Tables created by `SCHEMA_STATEMENTS` in `database.py`:

| Table | Notes |
| --- | --- |
| `schema_meta` | key/value bookkeeping (e.g. `legacy_migrated_at`) |
| `devices` | `device_id` PK, `user_id`, hardware/app metadata, `capabilities` JSON, `token_hash` UNIQUE, `last_seen_at` |
| `emergencies` | `emergency_id` (UUID) PK, `user_id`, `device_id` FK, `status`, `trigger_type`/`trigger_metadata`, latest lat/lng/`digipin`/`digipin_available`, `location_accuracy_m`/`location_provider`, `telemetry` JSON, `client_emergency_id`, `created_at`, `activated_at`, `last_update_at`, `ended_at`, `ended_by`, `resolution_note`, `cancelled_at`, `cancel_reason` |
| `emergency_events` | `emergency_id` FK CASCADE, `event_type`, `description`, `payload` JSON, `source`, `timestamp` |
| `emergency_locations` | `emergency_id` FK CASCADE, lat/lng, `digipin`, `digipin_available`, accuracy/altitude/speed/heading, `provider`, `is_mock`, `timestamp` |
| `audio_segments` | `segment_id` PK, `emergency_id` FK CASCADE, `sequence`, `file_name`/`file_path`, `mime_type`, `size_bytes`, `duration_seconds`, `sample_rate`, `channels`, `codec`, `started_at`/`ended_at` |
| `users` | `user_id` UNIQUE, `pin_hash` |
| `emergency_contacts` | `user_id`, `name`, `phone_number`, `relationship` |

**Guarantees enforced in SQL, not just app code:**
- `idx_one_active_per_user` — a **partial unique index** on `emergencies(user_id)
  WHERE status IN ('emergency','verifying')`. Race-safe at the DB level.
- `idx_emergencies_client_id` — unique partial index enabling idempotent
  `/start` retries.
- `idx_segments_sequence` — unique `(emergency_id, sequence)` so segment gaps
  stay visible rather than silently overwriting.
- `PRAGMA foreign_keys = ON` per connection; all child rows `ON DELETE CASCADE`.

`init_db()` runs `migrate_legacy_if_needed()` **first**, then `CREATE TABLE IF
NOT EXISTS` + additive `ALTER TABLE ... ADD COLUMN` + index creation. Idempotent,
preserves data.

---

## 8. API surface

**Auth:** devices send `Authorization: Bearer <device_token>` from
`POST /api/devices/register`. The dashboard sends a session JWT from
`POST /api/auth/dashboard/login`. WebSockets and `<audio>` tags use `?token=`
because browsers cannot set headers on them.

### Meta / public
| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | status, version, env, realtime hub counters |
| `GET` | `/api/config` | public runtime config incl. DIGIPIN status + coverage box |
| `GET` | `/docs` | OpenAPI |

### Auth, devices, PIN, contacts
| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/dashboard/login` | shared token → session JWT |
| `GET` | `/api/auth/dashboard/session` | describe the auth scheme (never leaks the token) |
| `POST` | `/api/devices/register` | needs `X-Enrollment-Token`; returns `device_token` (`zk_…`) |
| `GET` | `/api/devices/me` | device identity + `has_active_emergency` (used to recover after a kill) |
| `GET` | `/api/devices/config` | server-side emergency parameters |
| `POST` | `/api/pin/set` | device-scoped; requires `current_pin` to change an existing PIN |
| `POST` | `/api/pin/verify` | device-scoped |
| `GET` | `/api/pin/status/{user_id}` | device-scoped |
| `POST` `GET` `DELETE` | `/api/contacts`, `/api/contacts/{user_id}`, `/api/contacts/{contact_id}` | device-scoped emergency contacts |
| `POST` | `/api/contacts/test-sms` | send a test alert to all contacts |

### Emergency session (device-authenticated)
| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/emergencies/start` | idempotent via `client_emergency_id`; `409` + existing id if already active |
| `GET` | `/api/emergencies/active` | recover an in-flight session |
| `GET` | `/api/emergencies/{id}` | full record |
| `POST` | `/api/emergencies/{id}/locations` | server generates the DIGIPIN |
| `POST` | `/api/emergencies/{id}/telemetry` | battery, network, service state, sensors, capabilities |
| `POST` | `/api/emergencies/{id}/events` | timeline entry |
| `POST` | `/api/emergencies/{id}/status` | `cancelled` (**PIN required**) / `resolved` |
| `POST` | `/api/emergencies/{id}/audio/segments` | multipart; extension allow-list; size cap |
| `GET` | `/api/emergencies/{id}/audio/segments[/{segment_id}]` | list / byte-range stream |
| `GET` | `/api/emergencies/{id}/live-audio/state` | polling fallback for the streaming indicator |

### Dashboard (JWT-authenticated, router-level dependency)
| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/dashboard/snapshot` | first-paint bootstrap: emergencies + stats + realtime + config |
| `GET` | `/api/dashboard/emergencies` | `?status=&active_only=&user_id=&limit=` |
| `GET` | `/api/dashboard/emergencies/{id}` | full detail bundle |
| `GET` | `/api/dashboard/emergencies/{id}/events` · `/locations` | timelines / GPS track |
| `GET` | `/api/dashboard/emergencies/{id}/audio/segments[/{segment_id}]` | `?download=true` supported |
| `GET` | `/api/dashboard/emergencies/{id}/live-audio/state` | is the phone streaming? |
| `POST` | `/api/dashboard/emergencies/{id}/request-live-audio?enabled=` | command the phone to (stop) streaming |
| `POST` | `/api/dashboard/emergencies/{id}/resolve` | close it, with an optional note |
| `GET` | `/api/dashboard/devices` · `/stats` · `/health` | aggregates |

**Ownership rule:** the device router uses `_owned()`, which returns **404, not
403**, for another user's emergency — an attacker cannot even probe which
emergency ids exist. Ended emergencies are immutable (`409`).

---

## 9. Realtime protocol (the wire contracts)

Three sockets, all in `routers/ws.py`, all fanned out through `realtime.manager`:

| Socket | Auth | Direction |
| --- | --- | --- |
| `WS /ws/dashboard?token=<session>` | dashboard JWT | server → client |
| `WS /ws/device/{emergency_id}?token=<device>` | device token | bidirectional; JSON + binary |
| `WS /ws/live-audio/{emergency_id}?token=<session>` | dashboard JWT | binary server → listener |

Every refactored message carries its `emergency_id`; clients ignore frames for
other emergencies and the server only fans out to subscribers of that emergency.

### Dashboard channel (server → client)
`hello` (full snapshot + `server_config` + clock) · `emergency.created` ·
`emergency.updated` (with `reason`: `location` / `telemetry` / `event` /
`heartbeat` / `audio` / `live_audio`) · `emergency.ended` · `event.added` ·
`audio.segment` · `live_audio.state` · `stats` · `device.updated`.
Client → server: `{"type":"ping"}` → `pong`, `{"type":"refresh"}` → fresh snapshot.

### Device channel (phone → server, JSON)
| `type` | Effect | Ack |
| --- | --- | --- |
| `ping` | — | `pong` |
| `heartbeat` | `touch_emergency` | `ack` (+ throttled `emergency.updated` every 15 s) |
| `location` | DIGIPIN + location row + event | `ack` with `digipin` (+ push throttled 3 s) |
| `telemetry` | `set_telemetry` | `ack` (+ push throttled 4 s) |
| `event` | timeline entry | `ack` |
| `audio_state` | sets the producer flag, stores the advertised format | `ack` with `listeners` |
| `end` | `cancelled` / `resolved` | `ack` |

Plus: **binary frames** = live PCM (`pcm_s16le`, 16 kHz, mono), relayed verbatim
to that emergency's listeners only; oversized frames are dropped with a
throttled warning. Server → device: `ready` (with format + intervals),
`emergency.ended`, and `live_audio.request` (from the dashboard's
request-live-audio endpoint).

**Throttling:** `_throttled(emergency_id, key, seconds)` limits broadcast
frequency per emergency per key — realtime fan-out is coalesced, not per-packet.

---

## 10. Tests

```bash
cd backend
../venv/Scripts/python.exe -m pip install -r requirements-dev.txt
../venv/Scripts/python.exe -m pytest tests/ -v          # 24 passed in ~14 s
```

`tests/conftest.py` provides `client` (session-scoped), `enroll`, `authority`,
`start_emergency`, `start`. Modules:

- `test_digipin.py` — coverage box, encode/decode, `outside_india_coverage` reason.
- `test_emergency_api.py` — full lifecycle over REST.
- `test_isolation.py` — **the important one**: two users with simultaneous
  emergencies; neither can read the other's record/locations/events/audio; `409`
  protects one-active-per-user; cancel without a PIN is rejected; audio segments
  can't cross emergencies.
- `test_e2e_live_server.py` — drives a **real uvicorn server over real
  sockets** (httpx + `websockets`), including the live-audio relay.

App tests: `cd mobile-app && flutter analyze && flutter test`.

---

## 11. Where to hook in (extension points)

This is the map of the seams you'll want when adding features.

**Add a new device→server field**
1. `models.py` — add it to the Pydantic model (validation lives here).
2. `database.py` — persist it (add an `ALTER TABLE` line to the additive
   migration section of `init_db()` if it's a new column).
3. `serializers.py` — decide whether it appears in `serialize_summary` (list
   view) or only `serialize_detail`.
4. `dashboard/app.js` — render it.
5. `mobile-app/lib/api.dart` + `telemetry.dart` — send it.

**Add a new emergency trigger type** → `TriggerType` enum in `models.py`; the
fall-detection thresholds live in `mobile-app/lib/sensors.dart` and are surfaced
through `lib/config.dart`.

**Add a new realtime message** → add a builder in `notify.py`, broadcast via
`manager.broadcast_dashboard` / `send_to_device`, then handle the new `type` in
`dashboard/app.js` and/or `mobile-app/lib/api.dart`.

**Add a new endpoint** → new function in the relevant `routers/*.py`; use
`Depends(get_device)` for phone routes (`_owned()` for ownership) or
`Depends(get_authority)` for authority routes. Add `notify.push_*` calls if the
dashboard must react live.

**Add an authority action (like request-live-audio)** → `routers/dashboard.py`
endpoint + `manager.send_to_device(...)` + a handler branch in
`routers/ws.py::_handle_device_message` on the device side.

**Swap the database** → every SQL statement is confined to `database.py`; the
rest of the codebase only calls its functions and consumes plain dicts. That is
the single file to port to Postgres.

**Scale horizontally** → the blockers are (a) the in-process `ConnectionManager`
and (b) the SQLite file. Put the hub behind Redis pub/sub and move to
Postgres(es) with the partial unique index reproduced as a real unique index.

**Notification channels** → `sms_service.py` is the template: a module with a
lazy client, a message formatter, and a `send_*(...)` returning result dicts,
called from `_send_sms_alerts()` in `routers/emergencies.py`. Note SMS is
deliberately wrapped in try/except so it can never break the emergency flow.

---

## 12. Known gaps, gotchas and footguns

| Item | Detail |
| --- | --- |
| **`venv/` is committed but broken** | `pyvenv.cfg` referenced another machine's Python (`cheta`). It has been repointed to the local 3.12 and all 94 packages import fine, but a fresh clone on another machine should really create its own venv |
| **`backend/.env` holds live Twilio credentials** | `backend/.env` is gitignored, and no `.env` is tracked — but the file on disk contains a real `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. If that key ever leaked (screenshot, paste, backup), **rotate it in the Twilio console**. Never commit `.env` |
| **`backend/data/audio/**/*.wav` are untracked but not ignored** | `.gitignore` covers `*.db` but not audio. `git status` currently shows ~20 stray `.wav` recordings and a `.webm`, plus `backend/data/stale_pin_backup_user_001.txt` (a leftover containing a PIN hash). Add `backend/data/` (or `backend/data/audio/`) to `.gitignore` before committing anything |
| **Single-worker only** | In-process realtime hub + SQLite. `--workers 2+` will silently break fan-out and the one-active-per-user race |
| **JWT secret doubles as the PIN salt** | Rotating `ZEROUI_JWT_SECRET` invalidates dashboard sessions **and** all stored PIN hashes |
| **PIN hashing is a salted SHA-256, not bcrypt/argon2** | Fine for a 4-digit prototype PIN behind device-scoped access; not brute-force-hard. `security.hash_pin` |
| **`verifying` status is reserved and unused** | Present in the enum, index and serializers, but no code path produces it |
| **No iOS/desktop/client beyond Android** | The Flutter project has no `ios/` target configured |
| **`usesCleartextTraffic="true"`** | Needed for local HTTP dev; must be removed for production (README documents this) |
| **Fall detection is a threshold detector** | Not ML. Misses slow falls, false-positives on hard drops. Thresholds are user-tunable in Settings |
| **DIGIPIN is India-only** | Coverage box lat 2.5–38.5, lng 63.5–99.5. Outside it the API returns `null` + a reason and the UI says "unavailable" — never a fabricated code |
| **Audio is best-effort on real devices** | OEM battery managers can kill the foreground service; the app reports its actual service state as telemetry, and segments resume by sequence number |
| **Offline outbox** | Locations/telemetry/events queue locally and flush in order on reconnect; socket backoff is 0.5 s → 15 s cap |
| **Duplicate module name** | `notify.py` is listed as both realtime push helpers and (in one DIAGRAMS line) an SMS module. The SMS module is `sms_service.py`; `notify.py` is realtime only |

---

## 13. Thirty-second mental model

> A phone detects a fall, gives the user 15 seconds and a PIN to say "I'm fine"
> — and if they can't, it becomes a live sensor feed on an authority's screen.
> The backend is one FastAPI process with one SQLite file; **one UUID per
> emergency is threaded through every row, every socket and every audio file**,
> which is what keeps parallel emergencies from ever contaminating each other.
> The dashboard and the browser phone are just two more clients of the same API
> the Android app uses.
