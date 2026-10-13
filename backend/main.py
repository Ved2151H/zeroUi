"""
Zero UI Emergency Assistance System — FastAPI backend
====================================================

Assembly point: configuration, lifespan (schema + migration), routers, static
hosting of the dashboard and the browser-based mobile simulator.

Run:
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from database import (
    add_contact,
    dashboard_stats,
    get_contacts,
    get_user,
    init_db,
    remove_contact,
    set_user_pin,
    user_has_pin,
    verify_user_pin,
)
from models import ContactCreate, DashboardLogin, PinSet, PinVerify
from realtime import manager
from routers.auth import router as auth_router
from routers.dashboard import router as dashboard_router
from routers.devices import router as devices_router
from routers.emergencies import router as emergencies_router
from routers.ws import router as ws_router
from security import get_device
from serializers import serialize_device

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s:%(name)s:%(message)s",
)
logger = logging.getLogger("zeroui")


@asynccontextmanager
async def lifespan(app: FastAPI):
    summary = await init_db()
    os.makedirs(settings.audio_dir, exist_ok=True)
    logger.warning("Zero UI backend starting — %s", settings.as_log_dict())
    if summary.get("migrated"):
        logger.warning("Database migrated from the legacy schema: %s", summary["migrated"])
    if not settings.is_production:
        logger.warning(
            "Development auth tokens are active. Set ZEROUI_DASHBOARD_TOKEN / "
            "ZEROUI_ENROLLMENT_TOKEN / ZEROUI_JWT_SECRET in backend/.env before deploying."
        )
    yield
    logger.warning("Zero UI backend shutting down")


app = FastAPI(
    title="Zero UI Emergency Assistance System",
    version="2.0.0",
    description=(
        "Realtime emergency backend: device ingest (REST + WebSocket), live audio "
        "relay, DigiPIN location codes and the authority dashboard API."
    ),
    lifespan=lifespan,
)

# CORS: credentials are only allowed with explicit origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials="*" not in settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──
app.include_router(auth_router)
app.include_router(devices_router)
app.include_router(emergencies_router)
app.include_router(dashboard_router)
app.include_router(ws_router)


# ─── Safety PIN (device-scoped) ───────────────────────────────────────
# The PIN is the second factor that lets a user dismiss an emergency.  It is
# stored salted+hashed, and all PIN calls are scoped to the enrolled device's
# own user so nobody else can probe or brute-force another user's PIN.

@app.post("/api/pin/set", tags=["pin"])
async def set_pin(data: PinSet, device: dict = Depends(get_device)):
    if data.user_id != device["user_id"]:
        raise HTTPException(status_code=403, detail="Device is not enrolled for this user")

    if await user_has_pin(data.user_id):
        if not data.current_pin:
            raise HTTPException(status_code=403, detail="Current PIN required to change an existing PIN")
        if not await verify_user_pin(data.user_id, data.current_pin):
            raise HTTPException(status_code=403, detail="Current PIN is incorrect")

    await set_user_pin(data.user_id, data.pin)
    logger.info("Safety PIN set for user %s", data.user_id)
    return {"status": "ok", "message": f"Safety PIN set for user {data.user_id}"}


@app.post("/api/pin/verify", tags=["pin"])
async def verify_pin(data: PinVerify, device: dict = Depends(get_device)):
    if data.user_id != device["user_id"]:
        raise HTTPException(status_code=403, detail="Device is not enrolled for this user")
    if not await verify_user_pin(data.user_id, data.pin):
        logger.warning("Failed PIN verification for user %s", data.user_id)
        raise HTTPException(status_code=403, detail="Invalid PIN")
    return {"status": "ok", "verified": True}


@app.get("/api/pin/status/{user_id}", tags=["pin"])
async def pin_status(user_id: str, device: dict = Depends(get_device)):
    if user_id != device["user_id"]:
        raise HTTPException(status_code=403, detail="Device is not enrolled for this user")
    return {"user_id": user_id, "has_pin": await user_has_pin(user_id)}


# ─── Emergency contacts (device-scoped) ───────────────────────────────

@app.post("/api/contacts", tags=["contacts"])
async def create_contact(data: ContactCreate, device: dict = Depends(get_device)):
    if data.user_id != device["user_id"]:
        raise HTTPException(status_code=403, detail="Device is not enrolled for this user")
    contact_id = await add_contact(data.user_id, data.name, data.phone_number, data.relationship)
    return {"status": "ok", "contact_id": contact_id,
            "message": f"Contact '{data.name}' added for user {data.user_id}"}


@app.get("/api/contacts/{user_id}", tags=["contacts"])
async def list_contacts(user_id: str, device: dict = Depends(get_device)):
    if user_id != device["user_id"]:
        raise HTTPException(status_code=403, detail="Device is not enrolled for this user")
    contacts = await get_contacts(user_id)
    return {"user_id": user_id, "contacts": contacts, "count": len(contacts)}


@app.delete("/api/contacts/{contact_id}", tags=["contacts"])
async def delete_contact(contact_id: int, user_id: str = Query(...), device: dict = Depends(get_device)):
    if user_id != device["user_id"]:
        raise HTTPException(status_code=403, detail="Device is not enrolled for this user")
    if not await remove_contact(contact_id, user_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"status": "ok", "message": "Contact removed"}


@app.post("/api/contacts/test-sms", tags=["contacts"])
async def test_sms(user_id: str = Query(...), device: dict = Depends(get_device)):
    if user_id != device["user_id"]:
        raise HTTPException(status_code=403, detail="Device is not enrolled for this user")
    contacts = await get_contacts(user_id)
    if not contacts:
        raise HTTPException(status_code=404, detail="No contacts configured")

    from sms_service import send_sms

    message = (
        "✅ TEST from Zero UI Emergency System\n\n"
        f"This is a test notification for user: {user_id}\n"
        "Your emergency contact is set up correctly!\n"
        "You will receive alerts if an emergency is detected."
    )
    results = []
    for contact in contacts:
        result = send_sms(contact["phone_number"], message)
        result["contact"] = contact["name"]
        results.append(result)
    sent = sum(1 for r in results if r.get("success"))
    return {"sent": sent, "total": len(results), "results": results}


# ─── Public info / health ─────────────────────────────────────────────

@app.get("/health", tags=["meta"])
async def health():
    return {
        "status": "ok",
        "version": app.version,
        "env": settings.env,
        "auth": "device-token + dashboard-jwt",
        "realtime": manager.snapshot(),
    }


@app.get("/api/config", tags=["meta"])
async def public_config():
    """Public configuration used by the mobile app before enrolment."""
    from digipin_service import digipin_status

    return {
        "countdown_seconds": settings.countdown_seconds,
        "location_interval_seconds": settings.location_interval_seconds,
        "audio_segment_seconds": settings.audio_segment_seconds,
        "stale_after_seconds": settings.stale_after_seconds,
        "digipin": digipin_status(),
        "api_version": app.version,
    }


# ─── Legal notices ────────────────────────────────────────────────────
# The console links to these from its compliance panel. They are served by
# the authority's own deployment and describe the defaults of this build, so
# an operator can replace the text with their organisation's own policy.

_LEGAL_SHELL = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>{title} | Zero UI</title>
<style>
  :root {{
    --bg:#0c0c0e; --surface:#141417; --border:#2b2b31; --border-strong:#3d3d45;
    --text:#f1f0ed; --text-2:#a4a29d; --text-3:#726f69; --accent:#c8a96a;
    --mono:'IBM Plex Mono', ui-monospace, Menlo, monospace;
  }}
  *,*::before,*::after {{ box-sizing:border-box; }}
  body {{
    margin:0; background:var(--bg); color:var(--text);
    font:15px/1.7 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing:antialiased;
  }}
  main {{ max-width:760px; margin:0 auto; padding:56px 28px 96px; }}
  .eyebrow {{
    font-family:var(--mono); font-size:11px; letter-spacing:.14em;
    text-transform:uppercase; color:var(--text-3);
  }}
  h1 {{ font-size:26px; font-weight:600; letter-spacing:-.01em; margin:10px 0 6px; }}
  h2 {{
    font-size:11px; font-weight:500; letter-spacing:.12em; text-transform:uppercase;
    color:var(--text-3); margin:36px 0 10px; padding-bottom:8px;
    border-bottom:1px solid var(--border); font-family:var(--mono);
  }}
  p, li {{ color:var(--text-2); }}
  p {{ margin:0 0 12px; }}
  ul {{ margin:0 0 12px; padding-left:20px; }}
  li {{ margin-bottom:6px; }}
  strong {{ color:var(--text); font-weight:600; }}
  code {{
    font-family:var(--mono); font-size:13px; color:var(--accent);
    background:var(--surface); border:1px solid var(--border);
    padding:1px 5px; border-radius:3px;
  }}
  a {{ color:var(--accent); }}
  .rule {{ height:1px; background:var(--border); margin:28px 0; }}
  .meta {{ font-family:var(--mono); font-size:12px; color:var(--text-3); }}
  .back {{
    display:inline-block; margin-bottom:34px; font-family:var(--mono);
    font-size:12px; letter-spacing:.06em; text-decoration:none;
    border:1px solid var(--border-strong); border-radius:3px; padding:6px 12px;
    color:var(--text-2);
  }}
  .back:hover {{ color:var(--text); border-color:var(--accent); }}
</style></head>
<body><main>
<a class="back" href="/dashboard/">Back to console</a>
<div class="eyebrow">Zero UI Emergency Assistance</div>
<h1>{title}</h1>
<p class="meta">Version {version} · Last updated {updated}</p>
<div class="rule"></div>
{body}
</main></body></html>"""

_LEGAL_UPDATED = "12 October 2026"

_TERMS_BODY = """
<h2>1. What this software is</h2>
<p>Zero UI is an emergency assistance system. A registered mobile device can raise an
incident; an authenticated authority console receives that incident, its location trail,
its telemetry and its recorded audio.</p>
<p>This build is intended for evaluation by the deploying organisation. It is not a
substitute for the public emergency number in your region. Where life is at immediate
risk, contact the official emergency service first.</p>

<h2>2. Authority access</h2>
<p>Access to the console requires a dashboard token issued by the deploying authority.
Operators must keep that token confidential, must not share sessions, and must report
suspected disclosure to their administrator without delay.</p>

<h2>3. Acceptable use</h2>
<ul>
  <li>Use incident data only to respond to the incident it belongs to.</li>
  <li>Do not extract, forward, publish or re-purpose emergency audio or precise location.</li>
  <li>Do not attempt to reach data belonging to an incident you are not handling.</li>
  <li>Raise incidents in good faith. Deliberate false alarms may be an offence.</li>
</ul>

<h2>4. Availability</h2>
<p>The software is provided as is, without warranty of uninterrupted or error-free
operation. The deploying authority is responsible for hosting, connectivity, backups and
storage configuration.</p>

<h2>5. Changes</h2>
<p>The deploying authority may amend these terms. The version and date shown above
always describe the text in force.</p>
"""

_PRIVACY_BODY = """
<h2>1. Data collected during an emergency</h2>
<ul>
  <li><strong>Device and session identifiers</strong> for the device that raised the incident.</li>
  <li><strong>GPS fixes</strong> captured at the configured interval, plus the derived DIGIPIN.</li>
  <li><strong>Device and sensor telemetry</strong> gathered while the session is active.</li>
  <li><strong>An event trail</strong> of status changes and operator actions.</li>
  <li><strong>Audio</strong> recorded by the device microphone in short segments.</li>
</ul>
<p>Nothing above is recorded unless an emergency session is active. A cancelled countdown
creates no record at all.</p>

<h2>2. Why it is collected</h2>
<p>Solely to let an authority operator understand and respond to the incident, and to keep
an auditable record of how it was handled.</p>

<h2>3. Who can access it</h2>
<p>Only authenticated authority sessions. Every incident, audio segment and realtime
channel is scoped to a single emergency identifier, so an operator viewing one incident
cannot retrieve another user's location or audio.</p>

<h2>4. Retention</h2>
<p>Location, telemetry and audio are retained in the storage configured by the deploying
authority (<code>ZEROUI_DATA_DIR</code>) until that authority deletes them. The console
itself never deletes incident data; deletion is a deliberate administrative action.</p>

<h2>5. Operator responsibility</h2>
<p>Emergency audio and precise location are sensitive personal data. Handle them only for
the incident being responded to, and follow your organisation's handling policy.</p>
"""


def _legal_page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        _LEGAL_SHELL.format(title=title, body=body, version=app.version, updated=_LEGAL_UPDATED)
    )


@app.get("/download/zeroui.apk", tags=["meta"], include_in_schema=False)
async def download_apk():
    """Serve the built handset app so an operator can install it from a phone.

    Deliberately unauthenticated: the phone that is about to run this app has no
    dashboard session yet, and the file is public build output rather than data.
    A fresh build tree wins; otherwise the copy committed under `dist/` is
    served. When neither exists, this answers ``404`` with the command to run
    rather than returning an empty or partially-written file.
    """
    path = next(
        (
            candidate
            for candidate in (settings.apk_path, settings.apk_fallback_path)
            if os.path.isfile(candidate)
        ),
        None,
    )
    if path is None:
        raise HTTPException(
            status_code=404,
            detail={
                "message": "No Android build on this server yet",
                "expected_paths": [
                    settings.apk_path,
                    settings.apk_fallback_path,
                ],
                "build_command": "cd mobile-app && flutter build apk --release "
                                 "--dart-define=ZEROUI_API_BASE=http://<this-host>:8000",
            },
        )
    # FileResponse sets Content-Length from the file itself, so the phone gets a
    # progress bar; the download is named `zeroui.apk` in the file manager.
    return FileResponse(
        path,
        media_type="application/vnd.android.package-archive",
        filename="zeroui.apk",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/legal/terms", tags=["meta"], include_in_schema=False)
async def legal_terms():
    return _legal_page("Terms of Service", _TERMS_BODY)


@app.get("/legal/privacy", tags=["meta"], include_in_schema=False)
async def legal_privacy():
    return _legal_page("Privacy Policy", _PRIVACY_BODY)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Log unexpected errors with context instead of returning a bare 500."""
    logger.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc,
                 exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ── Static hosting: dashboard + browser mobile simulator ──


class _HtmlRevalidatingStaticFiles(StaticFiles):
    """Static host that makes documents revalidate on every load.

    The console's assets carry a ``?v=`` query that changes with each release,
    so they can be cached safely. The documents that reference them could not:
    Starlette sends no ``Cache-Control``, which lets the browser apply
    *heuristic* freshness to ``index.html`` and keep serving a console from an
    earlier session long after the files on disk changed. Operators then report
    a bug that is already fixed — an old page with a stale asset version is
    indistinguishable from a failed deploy.

    ``no-cache`` still allows the ETag and Last-Modified from StaticFiles to
    answer with a 304, so an unchanged document costs no body transfer; it only
    forces the check.

    Scripts and stylesheets are included even though they carry ``?v=``: the
    version is only as good as the person who remembers to bump it, and one
    forgotten bump serves last release's ``app.js`` against this release's
    ``index.html`` — a mismatch that presents as a feature that silently did not
    ship. Revalidating costs a 304 when nothing changed.
    """

    #: Extensions that must be revalidated before use.
    REVALIDATE = (".html", ".js", ".css")

    def file_response(self, full_path, stat_result, scope, status_code: int = 200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        if str(full_path).lower().endswith(self.REVALIDATE):
            response.headers["Cache-Control"] = "no-cache"
        return response


if os.path.isdir(settings.dashboard_dir):
    app.mount(
        "/dashboard",
        _HtmlRevalidatingStaticFiles(directory=settings.dashboard_dir, html=True),
        name="dashboard",
    )
    logger.info("Dashboard mounted at /dashboard from %s", settings.dashboard_dir)

if os.path.isdir(settings.mobile_simulator_dir):
    app.mount(
        "/mobile",
        _HtmlRevalidatingStaticFiles(directory=settings.mobile_simulator_dir, html=True),
        name="mobile-simulator",
    )
    logger.info("Mobile simulator mounted at /mobile from %s", settings.mobile_simulator_dir)


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/dashboard/")
