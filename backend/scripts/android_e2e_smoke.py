"""Zero UI end-to-end smoke test.

Talks to a live backend exactly the way the Android app does, then reads the
incident back through the dashboard API. Nothing here is a unit test; the point
is to prove the three tiers agree about one emergency_id.

  Android-shaped writes  ->  /api/devices, /api/emergencies
  Authority-shaped reads ->  /api/dashboard
"""
import io
import math
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid
import wave

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8011"
ENROLL = "zeroui-dev-enroll-token"
DASH = "zeroui-dev-dashboard-token"

# A real place: Chhatrapati Sambhajinagar, the console's default map centre.
LAT, LON = 19.8762, 75.3433
LAT2, LON2 = 19.8769, 75.3441     # a few metres later, same incident

failures = []
checks = []


def check(label, ok, detail=""):
    checks.append((label, ok, detail))
    if not ok:
        failures.append(label)


def call(method, path, body=None, headers=None, raw=None, ctype=None):
    url = BASE + path
    hdrs = dict(headers or {})
    if raw is not None:
        data = raw
        hdrs["Content-Type"] = ctype or "application/octet-stream"
    elif body is not None:
        import json
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    else:
        data = None
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = resp.read()
            try:
                import json
                return resp.status, json.loads(payload)
            except Exception:
                return resp.status, payload
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def wav_15s(seconds=15, rate=16000):
    """A real 15 s PCM16 mono 440 Hz tone (the app records from the mic)."""
    frames = io.BytesIO()
    for n in range(rate * seconds):
        value = int(1800 * math.sin(2 * math.pi * 440 * n / rate))
        frames.write(struct.pack("<h", value))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(frames.getvalue())
    return buf.getvalue()


# ── wait for the server ───────────────────────────────────────────────
for _ in range(60):
    try:
        status, _ = call("GET", "/health")
        if status == 200:
            break
    except Exception:
        pass
    time.sleep(0.5)
else:
    print("FAIL: backend never became healthy")
    sys.exit(1)

user = "smoke_" + uuid.uuid4().hex[:8]

# ── 1. device enrolment (what onboarding does) ────────────────────────
status, reg = call(
    "POST",
    "/api/devices/register",
    {
        "user_id": user,
        "display_name": "Smoke Test Handset",
        "platform": "android",
        "manufacturer": "smoke",
        "model": "smoke-device",
        "os_version": "15",
        "app_version": "2.0.0",
        "capabilities": {"fall_detection": True, "gyroscope": True},
    },
    {"X-Enrollment-Token": ENROLL},
)
check("device registers", status == 200 and "device_token" in reg, f"http {status}")
if status != 200:
    print(f"FAIL: POST /api/devices/register returned {status}")
    print(reg)
    sys.exit(1)
dev = {"X-Device-Token": reg["device_token"]}

# ── 2. start an emergency with the phone's real coordinates ──────────
client_id = "smoke-" + uuid.uuid4().hex[:12]
status, started = call(
    "POST",
    "/api/emergencies/start",
    {
        "trigger_type": "hardware",
        "latitude": LAT,
        "longitude": LON,
        "accuracy_m": 7.5,
        "location_provider": "gps",
        "location_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "trigger_metadata": {"presses": 3, "gesture": "volume_down_triple"},
        "capabilities": {"fall_detection": True},
        "device": {"model": "smoke-device"},
        "countdown_seconds": None,
        "client_emergency_id": client_id,
        "event_logs": [
            {
                "event_type": "hardware_button_triple_press",
                "description": "Hardware button triple press (3x volume down), no verification window",
                "payload": {"presses": 3},
            },
            {
                "event_type": "location_acquired",
                "description": "GPS fix acquired from the handset before activation",
                "payload": {"provider": "gps", "accuracy_m": 7.5},
            },
        ],
    },
    dev,
)
check("emergency starts", status in (200, 201), f"http {status}: {str(started)[:400]}")
if status not in (200, 201):
    print(f"FAIL: POST /api/emergencies/start returned {status}")
    print(started)
    sys.exit(1)

emergency = started.get("emergency", started)
eid = emergency.get("emergency_id")
check("emergency_id issued", bool(eid), eid or "missing")
check(
    "trigger type is hardware",
    emergency.get("trigger_type") == "hardware",
    str(emergency.get("trigger_type")),
)

# DigiPIN is issued by the backend from the real coordinates, never by the app.
digipin = emergency.get("digipin")
check("backend issues a DigiPIN at start", bool(digipin), str(digipin))

# ── 3. idempotent retry must not fork the incident ───────────────────
status, retry = call(
    "POST",
    "/api/emergencies/start",
    {
        "trigger_type": "hardware",
        "latitude": LAT,
        "longitude": LON,
        "location_provider": "gps",
        "client_emergency_id": client_id,
    },
    dev,
)
same = (retry.get("emergency") or {}).get("emergency_id") if status == 200 else None
check("retry reuses the same emergency_id", same == eid, f"{same}")

# ── 4. live location update stays on the same emergency ──────────────
status, loc = call(
    "POST",
    f"/api/emergencies/{eid}/locations",
    {
        "latitude": LAT2,
        "longitude": LON2,
        "accuracy_m": 6.0,
        "provider": "gps",
        "is_mock": False,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    },
    dev,
)
check("location update accepted", status == 200, f"http {status}: {str(loc)[:120]}")
check("location update reuses emergency_id", loc.get("emergency_id") == eid if status == 200 else False)

# ── 5. the 15-second first audio segment, real PCM16 ─────────────────
wav = wav_15s(15)
boundary = "----zeroui" + uuid.uuid4().hex
parts = []
for name, value in (
    ("sequence", "1"),
    ("duration_seconds", "15"),
    ("sample_rate", "16000"),
    ("channels", "1"),
    ("codec", "pcm16"),
):
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
    )
parts.append(
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
    f"filename=\"segment_0001.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode()
)
parts.append(wav)
parts.append(f"\r\n--{boundary}--\r\n".encode())
body = b"".join(parts)
status, seg = call(
    "POST",
    f"/api/emergencies/{eid}/audio/segments",
    raw=body,
    ctype=f"multipart/form-data; boundary={boundary}",
    headers=dev,
)
check("15 s audio segment uploads", status in (200, 201), f"http {status}: {str(seg)[:160]}")

# ── 6. the dashboard reads the same incident back ────────────────────
dash = {"X-Dashboard-Token": DASH}
status, detail = call("GET", f"/api/dashboard/emergencies/{eid}", headers=dash)
check("dashboard sees the incident", status == 200, f"http {status}")

status_list, listed_payload = call("GET", "/api/dashboard/emergencies", headers=dash)
list_rows = (
    listed_payload.get("emergencies", [])
    if isinstance(listed_payload, dict)
    else (listed_payload if isinstance(listed_payload, list) else [])
)
check("dashboard list is served", status_list == 200, f"http {status_list}")

if status == 200:
    blob = str(detail)
    check("dashboard shows DigiPIN", bool(digipin) and digipin in blob, digipin or "")
    latest = detail.get("latest_location") or detail.get("location") or {}
    lat = latest.get("latitude")
    check(
        "dashboard marker is the phone's real position",
        lat is not None and abs(lat - LAT2) < 1e-6,
        f"lat={lat}",
    )
    # The console renders status 'emergency' as the red "Active" pill; the wire
    # value is the source of truth, so assert on that.
    row = detail.get("emergency", detail)
    check(
        "dashboard shows the ACTIVE state",
        row.get("status") == "emergency",
        f"status={row.get('status')} -> label 'Active'",
    )
    check(
        "dashboard shows the hardware trigger",
        row.get("trigger_type") == "hardware",
        str(row.get("trigger_type")),
    )
    # The detail payload carries the boolean the console's KPI uses; the segment
    # count is an aggregate the list endpoint computes, checked below.
    check(
        "dashboard reports audio availability",
        bool(row.get("has_audio")),
        f"has_audio={row.get('has_audio')}",
    )
    listed = next((e for e in list_rows if e.get("emergency_id") == eid), None)
    check(
        "dashboard list counts the audio segment",
        bool(listed) and (listed.get("audio_segment_count") or 0) >= 1,
        f"count={(listed or {}).get('audio_segment_count')}",
    )
    check(
        "dashboard DigiPIN matches the backend",
        row.get("digipin") == loc.get("digipin"),
        f"{row.get('digipin')} vs {loc.get('digipin')}",
    )

status, segs = call("GET", f"/api/dashboard/emergencies/{eid}/audio/segments", headers=dash)
audio_ok = status == 200 and bool(segs)
count = len(segs) if isinstance(segs, list) else len(segs.get("segments", [])) if isinstance(segs, dict) else 0
check("dashboard lists the audio segment", audio_ok and count >= 1, f"http {status} count={count}")

# Fetch the bytes so "available" means playable, not just indexed.
if audio_ok and count >= 1:
    items = segs if isinstance(segs, list) else segs.get("segments", [])
    sid = items[0].get("segment_id") or items[0].get("id")
    status, data = call("GET", f"/api/dashboard/emergencies/{eid}/audio/segments/{sid}", headers=dash)
    check("dashboard can download the audio", status == 200 and len(data) == len(wav),
          f"http {status} bytes={len(data) if isinstance(data, bytes) else 'n/a'}")

# ── 7. the live console snapshot includes it ─────────────────────────
status, snap = call("GET", "/api/dashboard/snapshot", headers=dash)
check("dashboard snapshot is served", status == 200, f"http {status}")
if status == 200:
    text = str(snap)
    check("snapshot contains the emergency_id", eid in text, eid or "")

# ── report ───────────────────────────────────────────────────────────
print()
width = max(len(label) for label, _, _ in checks)
for label, ok, detail in checks:
    mark = "PASS" if ok else "FAIL"
    suffix = f"   ({detail})" if detail else ""
    print(f"[{mark}] {label:<{width}}{suffix}")

print()
print(f"{len(checks) - len(failures)}/{len(checks)} checks passed")
print(f"emergency_id = {eid}")
print(f"digipin      = {digipin}")
sys.exit(1 if failures else 0)
