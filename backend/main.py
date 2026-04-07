"""
Zero UI Emergency Assistance System — FastAPI Backend
=====================================================
Receives emergency data from the mobile simulator, stores it in SQLite,
and serves the monitoring dashboard with real-time data.
"""

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse

from models import EmergencyCreate, LocationUpdate, StatusUpdate
from database import (
    init_db,
    create_emergency,
    add_location,
    add_event,
    update_status,
    save_audio_path,
    get_emergency,
    get_all_emergencies,
)
from digipin_service import generate_digipin

app = FastAPI(
    title="Zero UI Emergency Assistance System",
    version="1.0.0",
    description="Backend API for emergency detection, alerting, and monitoring.",
)

# CORS — allow all for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
AUDIO_DIR = os.path.join(BASE_DIR, "data", "audio")
MOBILE_DIR = os.path.join(PROJECT_DIR, "mobile-simulator")
DASHBOARD_DIR = os.path.join(PROJECT_DIR, "dashboard")


@app.on_event("startup")
async def startup():
    """Initialize database and ensure directories exist."""
    await init_db()
    os.makedirs(AUDIO_DIR, exist_ok=True)


# ─── API ENDPOINTS ────────────────────────────────────────────────────────────


@app.post("/api/emergency")
async def create_new_emergency(data: EmergencyCreate):
    """Receive a new emergency alert from the mobile app."""
    # Generate DigiPIN server-side using official algorithm
    digipin = generate_digipin(data.latitude, data.longitude)
    payload = data.model_dump()
    payload["digipin"] = digipin
    emergency_id = await create_emergency(payload)
    return {
        "id": emergency_id,
        "status": "created",
        "message": "Emergency alert received",
        "digipin": digipin,
    }


@app.post("/api/emergency/{emergency_id}/location")
async def update_location(emergency_id: int, data: LocationUpdate):
    """Update live location for an active emergency."""
    existing = await get_emergency(emergency_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Emergency not found")
    # Generate DigiPIN server-side using official algorithm
    digipin = generate_digipin(data.latitude, data.longitude)
    payload = data.model_dump()
    payload["digipin"] = digipin
    await add_location(emergency_id, payload)
    await add_event(
        emergency_id,
        "location_update",
        f"📍 Location: ({data.latitude:.6f}, {data.longitude:.6f}) · DigiPIN: {digipin}",
    )
    return {"status": "updated", "digipin": digipin}


@app.post("/api/emergency/{emergency_id}/audio")
async def upload_audio(emergency_id: int, file: UploadFile = File(...)):
    """Upload an audio recording for an emergency."""
    existing = await get_emergency(emergency_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Emergency not found")

    # Save file
    ext = file.filename.split(".")[-1] if "." in file.filename else "webm"
    filename = f"emergency_{emergency_id}_{uuid.uuid4().hex[:8]}.{ext}"
    file_path = os.path.join(AUDIO_DIR, filename)

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    await save_audio_path(emergency_id, file_path)
    await add_event(
        emergency_id, "audio_uploaded", f"Audio file uploaded: {filename}"
    )
    return {"status": "uploaded", "filename": filename}


@app.get("/api/emergency/{emergency_id}/audio")
async def get_audio(emergency_id: int):
    """Stream audio file for an emergency."""
    existing = await get_emergency(emergency_id)
    if not existing or not existing.get("has_audio"):
        raise HTTPException(status_code=404, detail="Audio not found")

    file_path = existing.get("audio_path")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file missing")

    return FileResponse(
        file_path,
        media_type="audio/webm",
        filename=os.path.basename(file_path),
    )


@app.patch("/api/emergency/{emergency_id}/status")
async def change_status(emergency_id: int, data: StatusUpdate):
    """Update the status of an emergency."""
    existing = await get_emergency(emergency_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Emergency not found")
    await update_status(emergency_id, data.status.value)
    return {"status": "updated", "new_status": data.status.value}


@app.get("/api/emergencies")
async def list_emergencies(status: Optional[str] = Query(None)):
    """List all emergencies, optionally filtered by status."""
    emergencies = await get_all_emergencies(status)
    return {"emergencies": emergencies, "count": len(emergencies)}


@app.get("/api/emergency/{emergency_id}")
async def get_single_emergency(emergency_id: int):
    """Get detailed information about a single emergency."""
    emergency = await get_emergency(emergency_id)
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency not found")
    return emergency


# ─── STATIC FILE SERVING ──────────────────────────────────────────────────────

# Serve mobile simulator
if os.path.isdir(MOBILE_DIR):
    app.mount("/mobile", StaticFiles(directory=MOBILE_DIR, html=True), name="mobile")

# Serve dashboard
if os.path.isdir(DASHBOARD_DIR):
    app.mount(
        "/dashboard", StaticFiles(directory=DASHBOARD_DIR, html=True), name="dashboard"
    )


@app.get("/")
async def root():
    """Redirect root to the dashboard."""
    return RedirectResponse(url="/dashboard/")
