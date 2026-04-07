# 🛡️ Zero UI — Emergency Assistance System

A Zero-UI emergency detection and response system that automatically detects accidents, falls, and panic scenarios — then alerts emergency responders through a real-time monitoring dashboard.

## Architecture

```
┌─────────────────────┐         ┌──────────────────┐         ┌─────────────────────┐
│  Mobile Simulator   │ ──API──▶│  FastAPI Backend  │◀──API── │ Monitoring Dashboard │
│  (Web App)          │         │  (Python/SQLite)  │         │ (Web App)            │
│                     │         │                   │         │                      │
│  • Fall Detection   │         │  • Emergency CRUD │         │  • Emergency Cards   │
│  • Panic Trigger    │         │  • Event Logging  │         │  • Leaflet Map       │
│  • Voice Verify     │         │  • Audio Storage  │         │  • Event Timelines   │
│  • GPS + DigiPIN    │         │  • DigiPIN Gen    │         │  • Audio Playback    │
│  • Audio Recording  │         │  • Location Track │         │  • Status Management │
└─────────────────────┘         └──────────────────┘         └─────────────────────┘
```

## Detection Flow

```
PASSIVE ──┬── Fall Detected ───▶ VERIFYING ──┬── User responds ──▶ PASSIVE
          │                                   │
          │                                   └── No response ────▶ EMERGENCY
          │
          └── Triple Power Press ──────────────────────────────────▶ EMERGENCY (instant)
```

## Quick Start

### Prerequisites
- Python 3.10+
- pip

### Setup

```bash
# 1. Clone / navigate to the project
cd zeroui

# 2. Create a virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

# 3. Install dependencies
pip install -r backend/requirements.txt

# 4. Start the server
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Access

| Component | URL |
|-----------|-----|
| 📊 Dashboard | [http://localhost:8000/dashboard/](http://localhost:8000/dashboard/) |
| 📱 Mobile Simulator | [http://localhost:8000/mobile/](http://localhost:8000/mobile/) |
| 📡 API Docs | [http://localhost:8000/docs](http://localhost:8000/docs) |

## How to Demo

1. Open the **Dashboard** in one browser tab
2. Open the **Mobile Simulator** in another tab
3. In the simulator:
   - Click **"Simulate Fall"** → watch the verification countdown → let it time out → emergency appears in dashboard
   - Click **"Triple Power Press"** → instant emergency activation
   - Click **"I'm Okay"** during verification to cancel
   - Click **"Resolve Emergency"** to end an active emergency
4. In the dashboard:
   - See emergency cards appear in real-time
   - Click a card to see full event timeline + DigiPIN + map location
   - Click **"Mark as Resolved"** to close an emergency

## Project Structure

```
zeroui/
├── README.md
├── backend/
│   ├── requirements.txt          # Python dependencies
│   ├── main.py                   # FastAPI app + endpoints
│   ├── models.py                 # Pydantic request/response models
│   ├── database.py               # Async SQLite layer
│   ├── digipin.py                # Mock DigiPIN generator
│   └── data/                     # Auto-created: SQLite DB + audio files
├── mobile-simulator/
│   ├── index.html                # Phone-frame simulator UI
│   ├── style.css                 # Dark theme + glassmorphism
│   ├── app.js                    # State machine (Passive → Verifying → Emergency)
│   ├── sensors.js                # Accelerometer simulation + fall detection
│   ├── emergency.js              # SOS, GPS, DigiPIN, location updates
│   └── audio.js                  # MediaRecorder audio capture
└── dashboard/
    ├── index.html                # Command-center dashboard
    ├── style.css                 # Dark glassmorphism theme
    ├── app.js                    # Polling, cards, detail view, timeline
    └── map.js                    # Leaflet/OpenStreetMap integration
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/emergency` | Create new emergency |
| `POST` | `/api/emergency/{id}/location` | Update live location |
| `POST` | `/api/emergency/{id}/audio` | Upload audio recording |
| `PATCH` | `/api/emergency/{id}/status` | Change status |
| `GET` | `/api/emergencies` | List all emergencies |
| `GET` | `/api/emergency/{id}` | Get single emergency detail |
| `GET` | `/api/emergency/{id}/audio` | Stream audio file |

## Key Features

- **Staged Activation**: Passive → Verifying → Emergency (reduces false alarms)
- **DigiPIN**: Mock grid-based digital address system for precise location
- **Rule-based Detection**: No heavy ML models — uses accelerometer thresholds
- **Battery Efficient**: Microphone activated only during 5-8s verification window
- **Dark Theme**: Premium glassmorphism design with pulsing indicators
- **Real-time**: Dashboard polls every 5 seconds for updates

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Backend**: Python, FastAPI, SQLite (via aiosqlite)
- **Maps**: Leaflet.js + OpenStreetMap
- **Audio**: Web MediaRecorder API
- **Font**: Inter (Google Fonts)
