# Zero UI Emergency Assistance System — Diagrams

> Complete architectural, flow, and interaction diagrams for the Zero UI Emergency Assistance System.

---

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph MOBILE["📱 Mobile Simulator (Frontend)"]
        SENSORS["🔧 SensorModule<br>sensors.js"]
        AUDIO["🎤 AudioModule<br>audio.js"]
        EMERGENCY["🆘 EmergencyModule<br>emergency.js"]
        APP["🧠 App State Machine<br>app.js"]
    end

    subgraph BACKEND["⚙️ FastAPI Backend"]
        API["🌐 REST API<br>main.py"]
        MODELS["📋 Pydantic Models<br>models.py"]
        DB["🗄️ Database Layer<br>database.py"]
        DIGIPIN["📍 DigiPIN Service<br>digipin_service.py"]
    end

    subgraph STORAGE["💾 Storage Layer"]
        SQLITE[("🗃️ SQLite DB<br>emergencies.db")]
        AUDIOFILES["🔊 Audio Files<br>data/audio/")]
    end

    subgraph DASHBOARD["📊 Monitoring Dashboard"]
        DASHAPP["📈 Dashboard App<br>app.js"]
        MAP["🗺️ Map Module<br>map.js"]
        LEAFLET["🌿 Leaflet.js<br>OpenStreetMap"]
    end

    subgraph EXTERNAL["🌍 External Services"]
        PYPI["📦 digipin PyPI Package<br>India Post Algorithm"]
        GMAPS["🗺️ Google Maps<br>Location Links"]
        OSM["🌐 OpenStreetMap<br>Map Tiles"]
    end

    APP --> SENSORS
    APP --> AUDIO
    APP --> EMERGENCY
    EMERGENCY -->|HTTP POST| API
    API --> MODELS
    API --> DB
    API --> DIGIPIN
    DIGIPIN --> PYPI
    DB --> SQLITE
    API --> AUDIOFILES
    DASHAPP -->|HTTP GET Poll| API
    MAP --> LEAFLET
    LEAFLET --> OSM
    EMERGENCY --> GMAPS
    DASHAPP --> MAP

    style MOBILE fill:#1a1a2e,stroke:#e74c3c,color:#fff
    style BACKEND fill:#1a1a2e,stroke:#6c5ce7,color:#fff
    style STORAGE fill:#1a1a2e,stroke:#f1c40f,color:#fff
    style DASHBOARD fill:#1a1a2e,stroke:#2eb45a,color:#fff
    style EXTERNAL fill:#1a1a2e,stroke:#5dade2,color:#fff
```

---

## 2. App State Machine (Mobile Simulator)

```mermaid
stateDiagram-v2
    [*] --> PASSIVE

    PASSIVE --> VERIFYING : Fall Detected<br>(spike > 25 m/s² + 2.5s inactivity)
    PASSIVE --> EMERGENCY : Triple Power Press<br>(manual panic — instant)

    VERIFYING --> PASSIVE : User Responds "I'm Okay"<br>(within 8 seconds)
    VERIFYING --> EMERGENCY : No Response<br>(8-second countdown expires)

    EMERGENCY --> PASSIVE : Emergency Resolved<br>(user or dashboard resolves)

    state PASSIVE {
        [*] --> Monitoring
        Monitoring : 🛡️ Accelerometer active
        Monitoring : Sensor readings ~9.8 m/s²
        Monitoring : Low power mode
    }

    state VERIFYING {
        [*] --> Countdown
        Countdown : ⚠️ 8-second countdown
        Countdown : 🎤 Mic recording started
        Countdown : "Are you okay?" prompt
    }

    state EMERGENCY {
        [*] --> Active
        Active : 🆘 SOS sent to backend
        Active : 📍 GPS + DigiPIN acquired
        Active : 🎤 Audio recording
        Active : 📡 Location updates every 30s
    }
```

---

## 3. Emergency Trigger Flow — Fall Detection

```mermaid
flowchart TD
    START(["🏁 System Running<br>PASSIVE Mode"]) --> SENSOR["📊 SensorModule.tick()<br>runs every 100ms"]
    SENSOR --> READ["Read accelerometer<br>Normal: ~9.8 m/s²"]
    READ --> CHECK{"Acceleration<br>> 25 m/s²?"}
    CHECK -->|No| SENSOR
    CHECK -->|Yes| SPIKE["⚡ Impact Detected<br>30-45 m/s²"]
    SPIKE --> POST["📉 Post-spike<br>~5-8 m/s²"]
    POST --> INACTIVITY["📉 Near-zero readings<br>0.3-0.8 m/s²"]
    INACTIVITY --> TIMER{"Inactivity<br>> 2.5 seconds?"}
    TIMER -->|No| INACTIVITY
    TIMER -->|Yes| CONFIRMED["🚨 FALL CONFIRMED"]
    CONFIRMED --> CALLBACK["onFallDetected()<br>callback fired"]
    CALLBACK --> VERIFY["Enter VERIFYING Mode"]
    VERIFY --> MIC["🎤 Start mic recording"]
    MIC --> COUNTDOWN["⏱️ Start 8-second<br>countdown timer"]
    COUNTDOWN --> RESPONSE{"User responds<br>within 8s?"}
    RESPONSE -->|"I'm Okay"| SAFE["✅ Return to PASSIVE<br>Discard recording"]
    RESPONSE -->|No Response| ESCALATE["🆘 Escalate to EMERGENCY"]

    style START fill:#0a0a16,stroke:#2eb45a,color:#fff
    style CONFIRMED fill:#0a0a16,stroke:#e74c3c,color:#fff
    style SAFE fill:#0a0a16,stroke:#2eb45a,color:#fff
    style ESCALATE fill:#0a0a16,stroke:#e74c3c,color:#fff
```

---

## 4. Emergency Activation Flow — Full Sequence

```mermaid
flowchart TD
    TRIGGER(["🚨 Emergency Triggered<br>(fall or manual)"])
    TRIGGER --> SWITCH["switchView('EMERGENCY')"]
    SWITCH --> GPS["📍 Get GPS Position<br>getCurrentPosition()"]
    GPS --> GEOCHECK{"Geolocation<br>available?"}
    GEOCHECK -->|Yes| REAL["Use real coordinates"]
    GEOCHECK -->|No| FALLBACK["Use default + jitter<br>19.8762, 75.3433 ± 0.002"]
    REAL --> PAYLOAD["Build payload:<br>user_id, lat, lng,<br>trigger_type, event_logs"]
    FALLBACK --> PAYLOAD
    PAYLOAD --> SEND["POST /api/emergency"]
    SEND --> BACKEND["⚙️ Backend receives"]
    BACKEND --> GENPIN["🔢 Generate DigiPIN<br>digipin.encode(lat, lng)"]
    GENPIN --> STORE["💾 Store in SQLite<br>emergencies + locations + events"]
    STORE --> RESPOND["📤 Return {id, digipin}"]
    RESPOND --> UI["📱 Update mobile UI<br>GPS, DigiPIN, Maps link"]
    UI --> AUDIO_START["🎤 Start/continue<br>audio recording"]
    AUDIO_START --> LOC_INT["📡 Start location updates<br>setInterval(30s)"]
    LOC_INT --> PROTECT["🔒 Enable exit protection<br>onbeforeunload"]

    style TRIGGER fill:#0a0a16,stroke:#e74c3c,color:#fff
    style GENPIN fill:#0a0a16,stroke:#6c5ce7,color:#fff
    style STORE fill:#0a0a16,stroke:#f1c40f,color:#fff
```

---

## 5. DigiPIN Generation Flow

```mermaid
flowchart LR
    subgraph MOBILE["📱 Mobile (Frontend)"]
        GPS_ACQ["📍 GPS Acquired<br>lat: 19.8762<br>lng: 75.3433"]
    end

    subgraph NETWORK["🌐 HTTP"]
        POST_REQ["POST /api/emergency<br>{latitude, longitude, ...}"]
        RESPONSE["Response<br>{id, digipin: '4C3-FJ6-PLK3'}"]
    end

    subgraph BACKEND["⚙️ Backend"]
        ENDPOINT["FastAPI Endpoint"]
        SERVICE["digipin_service.py<br>generate_digipin()"]
        PYPI_LIB["digipin PyPI package<br>encode(lat, lng)"]
        DB_STORE["Store in SQLite"]
    end

    subgraph DISPLAY["📺 UI Display"]
        MOBILE_UI["Mobile: DigiPIN badge"]
        DASH_UI["Dashboard: Detail panel<br>+ Map popup + Card"]
    end

    GPS_ACQ --> POST_REQ
    POST_REQ --> ENDPOINT
    ENDPOINT --> SERVICE
    SERVICE --> PYPI_LIB
    PYPI_LIB -->|"'4C3-FJ6-PLK3'"| SERVICE
    SERVICE --> ENDPOINT
    ENDPOINT --> DB_STORE
    ENDPOINT --> RESPONSE
    RESPONSE --> MOBILE_UI
    DB_STORE -.->|"Poll /api/emergencies"| DASH_UI

    style MOBILE fill:#0a0a16,stroke:#e74c3c,color:#fff
    style BACKEND fill:#0a0a16,stroke:#6c5ce7,color:#fff
    style DISPLAY fill:#0a0a16,stroke:#2eb45a,color:#fff
```

---

## 6. Live Location Update Cycle

```mermaid
sequenceDiagram
    participant M as 📱 Mobile Simulator
    participant API as ⚙️ FastAPI Backend
    participant DP as 📍 DigiPIN Service
    participant DB as 🗄️ SQLite Database
    participant D as 📊 Dashboard

    Note over M: Emergency active — every 30 seconds
    loop Every 30 seconds
        M->>M: getCurrentPosition() + slight jitter
        M->>API: POST /api/emergency/{id}/location<br>{latitude, longitude, timestamp}
        API->>DP: generate_digipin(lat, lng)
        DP-->>API: "4C3-F4C-LMF9"
        API->>DB: INSERT INTO locations
        API->>DB: UPDATE emergencies (lat, lng, digipin)
        API->>DB: INSERT INTO events (location_update)
        API-->>M: {status: "updated", digipin: "4C3-F4C-LMF9"}
        M->>M: Update DigiPIN display
    end

    loop Every 5 seconds
        D->>API: GET /api/emergencies
        API->>DB: SELECT * FROM emergencies + events + locations
        DB-->>API: Emergency data with events
        API-->>D: {emergencies: [...]}
        D->>D: Update cards, map markers, detail panel
        D->>D: Append new timeline entries (with green glow)
        D->>D: Auto-scroll timeline to bottom
        D->>D: Live-update coords, DigiPIN, Maps link
    end
```

---

## 7. Audio Recording & Upload Flow

```mermaid
flowchart TD
    VERIFY_START(["⚠️ Verification Phase Starts"])
    VERIFY_START --> MIC_REQ["Request microphone access<br>getUserMedia({audio: true})"]
    MIC_REQ --> MIC_CHECK{"Permission<br>granted?"}
    MIC_CHECK -->|No| NO_AUDIO["⚠️ Continue without audio"]
    MIC_CHECK -->|Yes| RECORD["🎤 MediaRecorder.start()<br>Collect in 1s chunks<br>Format: audio/webm;codecs=opus"]

    RECORD --> ESCALATED{"Escalated to<br>EMERGENCY?"}
    ESCALATED -->|"User says 'I'm Okay'"| DISCARD["🗑️ Stop & discard blob"]
    ESCALATED -->|"No response"| CONTINUE["🎤 Recording continues<br>through emergency"]

    CONTINUE --> RESOLVE{"Emergency<br>resolved?"}
    RESOLVE --> STOP["⏹️ MediaRecorder.stop()"]
    STOP --> BLOB["📦 Create Blob from chunks"]
    BLOB --> UPLOAD["POST /api/emergency/{id}/audio<br>FormData with .webm file"]
    UPLOAD --> SAVE["💾 Save to data/audio/<br>emergency_{id}_{uuid}.webm"]
    SAVE --> EVENT["📝 Log audio_uploaded event"]
    EVENT --> AVAILABLE["🔊 Audio playable in<br>dashboard detail panel"]

    style VERIFY_START fill:#0a0a16,stroke:#f1c40f,color:#fff
    style DISCARD fill:#0a0a16,stroke:#2eb45a,color:#fff
    style AVAILABLE fill:#0a0a16,stroke:#6c5ce7,color:#fff
```

---

## 8. Dashboard Polling & Rendering Pipeline

```mermaid
flowchart TD
    BOOT(["🖥️ Dashboard Loads"]) --> INIT["Initialize MapModule<br>Leaflet + OpenStreetMap"]
    INIT --> POLL_START["Start polling loop<br>every 5 seconds"]
    POLL_START --> FETCH["GET /api/emergencies"]
    FETCH --> DATA["Parse response:<br>{emergencies: [...], count: N}"]
    DATA --> NEW_CHECK{"New emergency<br>IDs detected?"}
    NEW_CHECK -->|Yes| NOTIFY["🔔 Play notification sound"]
    NEW_CHECK -->|No| SKIP_NOTIFY["Skip notification"]
    NOTIFY --> UPDATE
    SKIP_NOTIFY --> UPDATE

    UPDATE["updateUI()"]
    UPDATE --> COUNTS["Update header stat chips<br>Active / Verifying / Resolved"]
    UPDATE --> CARDS["Render emergency cards<br>(with filter: All/Active/Verifying/Resolved)"]
    UPDATE --> MARKERS["Update map markers<br>(red=emergency, yellow=verifying, green=resolved)"]
    UPDATE --> DETAIL_CHECK{"Detail panel<br>open?"}
    DETAIL_CHECK -->|No| DONE["✅ Cycle complete"]
    DETAIL_CHECK -->|Yes| HASH_CHECK{"Data hash<br>changed?"}
    HASH_CHECK -->|No| LIVE_UPDATE["Live-update: time, coords,<br>DigiPIN, Maps link"]
    HASH_CHECK -->|Yes| RENDER["renderDetail()"]
    RENDER --> STATUS_UP["Update status badge"]
    RENDER --> GRID_UP["Update info grid"]
    RENDER --> AUDIO_CHECK{"Has audio?"}
    AUDIO_CHECK -->|Yes| AUDIO_LOAD["Load audio player<br>(never interrupts playback)"]
    AUDIO_CHECK -->|No| AUDIO_HIDE["Hide audio section"]
    RENDER --> TL_CHECK{"New timeline<br>entries?"}
    TL_CHECK -->|Yes| TL_APPEND["Append new entries<br>+ green glow animation<br>+ auto-scroll"]
    TL_CHECK -->|No| TL_SKIP["Skip timeline update"]
    LIVE_UPDATE --> DONE
    TL_APPEND --> DONE
    TL_SKIP --> DONE
    AUDIO_LOAD --> DONE
    AUDIO_HIDE --> DONE
    DONE --> FETCH

    style BOOT fill:#0a0a16,stroke:#2eb45a,color:#fff
    style NOTIFY fill:#0a0a16,stroke:#e74c3c,color:#fff
```

---

## 9. REST API Endpoint Map

```mermaid
graph LR
    subgraph ENDPOINTS["⚙️ API Endpoints"]
        E1["POST /api/emergency<br>Create new emergency"]
        E2["POST /api/emergency/{id}/location<br>Update live location"]
        E3["POST /api/emergency/{id}/audio<br>Upload audio recording"]
        E4["GET /api/emergency/{id}/audio<br>Stream audio file"]
        E5["PATCH /api/emergency/{id}/status<br>Change status"]
        E6["GET /api/emergencies<br>List all emergencies"]
        E7["GET /api/emergency/{id}<br>Get single emergency detail"]
    end

    subgraph STATIC["📁 Static Files"]
        S1["/mobile/ → Mobile Simulator"]
        S2["/dashboard/ → Monitoring Dashboard"]
        S3["/ → Redirect to /dashboard/"]
    end

    subgraph CALLERS["🔗 Who Calls"]
        C1["📱 Mobile Simulator"]
        C2["📊 Dashboard"]
    end

    C1 --> E1
    C1 --> E2
    C1 --> E3
    C1 --> E5
    C2 --> E4
    C2 --> E5
    C2 --> E6
    C2 --> E7

    style ENDPOINTS fill:#0a0a16,stroke:#6c5ce7,color:#fff
    style STATIC fill:#0a0a16,stroke:#5dade2,color:#fff
    style CALLERS fill:#0a0a16,stroke:#e74c3c,color:#fff
```

---

## 10. Database Entity Relationship Diagram

```mermaid
erDiagram
    EMERGENCIES {
        int id PK "AUTO INCREMENT"
        text user_id "NOT NULL"
        text status "emergency | verifying | resolved | safe"
        text trigger_type "fall | manual"
        real latitude "NOT NULL"
        real longitude "NOT NULL"
        text digipin "NOT NULL (India Post)"
        text created_at "ISO 8601"
        text resolved_at "nullable"
    }

    EVENTS {
        int id PK "AUTO INCREMENT"
        int emergency_id FK "References emergencies"
        text event_type "fall_detected, sos_sent, etc."
        text description "Human-readable"
        text timestamp "ISO 8601"
    }

    LOCATIONS {
        int id PK "AUTO INCREMENT"
        int emergency_id FK "References emergencies"
        real latitude "NOT NULL"
        real longitude "NOT NULL"
        text digipin "NOT NULL"
        text timestamp "ISO 8601"
    }

    AUDIO_FILES {
        int id PK "AUTO INCREMENT"
        int emergency_id FK "References emergencies"
        text file_path "Absolute path to .webm"
        text timestamp "ISO 8601"
    }

    EMERGENCIES ||--o{ EVENTS : "has many"
    EMERGENCIES ||--o{ LOCATIONS : "has many"
    EMERGENCIES ||--o{ AUDIO_FILES : "has many"
```

---

## 11. Emergency Resolution Flow

```mermaid
flowchart TD
    ACTIVE(["🆘 Emergency Active"])
    ACTIVE --> RESOLVE_SRC{"Who resolves?"}

    RESOLVE_SRC -->|"📱 Mobile User"| MOB_RESOLVE["User taps 'Resolve Emergency'"]
    RESOLVE_SRC -->|"📊 Dashboard Operator"| DASH_RESOLVE["Operator clicks '✓ Mark as Resolved'"]

    MOB_RESOLVE --> STOP_LOC["Stop location interval"]
    STOP_LOC --> STOP_MIC["Stop audio recording"]
    STOP_MIC --> UPLOAD_AUDIO["Upload .webm to backend<br>POST /api/emergency/{id}/audio"]
    UPLOAD_AUDIO --> PATCH_STATUS["PATCH /api/emergency/{id}/status<br>{status: 'resolved'}"]
    PATCH_STATUS --> DB_UPDATE["💾 Update DB:<br>status = resolved<br>resolved_at = now()"]
    DB_UPDATE --> LOG_EVENT["📝 Log status_change event"]
    LOG_EVENT --> CLEAR["Clear exit protection<br>Reset sensors<br>Clear event log"]
    CLEAR --> PASSIVE(["🛡️ Return to PASSIVE Mode"])

    DASH_RESOLVE --> DASH_PATCH["PATCH /api/emergency/{id}/status<br>{status: 'resolved'}"]
    DASH_PATCH --> DB_UPDATE
    DASH_PATCH --> DASH_REFRESH["Immediate poll refresh<br>Update cards, markers, detail panel"]

    style ACTIVE fill:#0a0a16,stroke:#e74c3c,color:#fff
    style PASSIVE fill:#0a0a16,stroke:#2eb45a,color:#fff
```

---

## 12. Project File Structure

```mermaid
graph TD
    ROOT["📁 zeroui/"]
    ROOT --> README["📄 README.md"]
    ROOT --> DIAGRAMS_FILE["📄 DIAGRAMS.md"]

    ROOT --> BE["📁 backend/"]
    BE --> MAIN["main.py<br>FastAPI app + routes"]
    BE --> MODELS_F["models.py<br>Pydantic schemas"]
    BE --> DB_F["database.py<br>SQLite async layer"]
    BE --> DIGI_F["digipin_service.py<br>India Post DigiPIN"]
    BE --> REQ["requirements.txt"]
    BE --> DATA["📁 data/"]
    DATA --> DB_FILE["emergencies.db"]
    DATA --> AUDIO_DIR["📁 audio/"]

    ROOT --> MOBILE["📁 mobile-simulator/"]
    MOBILE --> M_HTML["index.html"]
    MOBILE --> M_CSS["style.css"]
    MOBILE --> M_APP["app.js<br>State machine"]
    MOBILE --> M_SENS["sensors.js<br>Fall detection"]
    MOBILE --> M_AUDIO["audio.js<br>Mic recording"]
    MOBILE --> M_EMERG["emergency.js<br>Backend comm"]

    ROOT --> DASH["📁 dashboard/"]
    DASH --> D_HTML["index.html"]
    DASH --> D_CSS["style.css"]
    DASH --> D_APP["app.js<br>Polling + UI"]
    DASH --> D_MAP["map.js<br>Leaflet map"]

    style ROOT fill:#0a0a16,stroke:#6c5ce7,color:#fff
    style BE fill:#0a0a16,stroke:#f1c40f,color:#fff
    style MOBILE fill:#0a0a16,stroke:#e74c3c,color:#fff
    style DASH fill:#0a0a16,stroke:#2eb45a,color:#fff
```

---

## 13. Complete End-to-End Sequence Diagram

```mermaid
sequenceDiagram
    actor User as 👤 User
    participant Phone as 📱 Mobile Simulator
    participant Sensor as 🔧 SensorModule
    participant Audio as 🎤 AudioModule
    participant Emerg as 🆘 EmergencyModule
    participant API as ⚙️ FastAPI
    participant DigiPIN as 📍 DigiPIN Service
    participant DB as 🗄️ SQLite
    participant Dash as 📊 Dashboard

    Note over User, Dash: === PHASE 1: PASSIVE MONITORING ===
    Phone->>Sensor: start(onFallDetected)
    loop Every 100ms
        Sensor->>Sensor: tick() — read accelerometer (~9.8 m/s²)
    end

    Note over User, Dash: === PHASE 2: FALL DETECTION ===
    User->>Phone: 📉 "Simulate Fall" button
    Phone->>Sensor: simulateFall()
    Sensor->>Sensor: spike (30-45 m/s²)
    Sensor->>Sensor: post-spike (5-8 m/s²)
    Sensor->>Sensor: inactivity (0.3-0.8 m/s²) for 2.5s
    Sensor->>Phone: onFallDetected() callback

    Note over User, Dash: === PHASE 3: VERIFICATION ===
    Phone->>Audio: startRecording()
    Audio->>Audio: getUserMedia() → MediaRecorder.start()
    Phone->>Phone: Start 8s countdown
    alt User responds
        User->>Phone: ✅ "I'm Okay"
        Phone->>Audio: stopRecording() → discard
        Phone->>Phone: Return to PASSIVE
    else No response (8s expires)
        Phone->>Phone: No response → escalate
    end

    Note over User, Dash: === PHASE 4: EMERGENCY ACTIVE ===
    Phone->>Emerg: activate(userId, "fall", eventLog)
    Emerg->>Emerg: getCurrentPosition()
    Emerg->>API: POST /api/emergency
    API->>DigiPIN: generate_digipin(lat, lng)
    DigiPIN-->>API: "4C3-FJ6-PLK3"
    API->>DB: INSERT emergency + locations + events
    API-->>Emerg: {id: 11, digipin: "4C3-FJ6-PLK3"}
    Emerg-->>Phone: Update UI (GPS, DigiPIN, Maps)

    Note over User, Dash: === PHASE 5: LIVE MONITORING ===
    loop Every 30 seconds
        Emerg->>API: POST /api/emergency/{id}/location
        API->>DigiPIN: generate_digipin(new_lat, new_lng)
        API->>DB: INSERT location + UPDATE emergency
        API-->>Emerg: {digipin: "4C3-F4C-LMF9"}
    end

    loop Every 5 seconds
        Dash->>API: GET /api/emergencies
        API->>DB: Query all data
        API-->>Dash: {emergencies: [...]}
        Dash->>Dash: Update cards, map, timeline
    end

    Note over User, Dash: === PHASE 6: RESOLUTION ===
    User->>Phone: 🏁 "Resolve Emergency"
    Phone->>Audio: stopRecording()
    Audio-->>Phone: Audio Blob
    Phone->>API: POST /api/emergency/{id}/audio (upload .webm)
    API->>DB: Save audio file path
    Phone->>API: PATCH /api/emergency/{id}/status {resolved}
    API->>DB: UPDATE status, resolved_at
    Phone->>Phone: Return to PASSIVE
    Dash->>API: GET /api/emergencies (next poll)
    Dash->>Dash: Update card → green "RESOLVED"
```

---

## 14. Technology Stack Overview

```mermaid
mindmap
    root((Zero UI<br>Emergency System))
        Frontend
            HTML5
            CSS3
                Custom Properties
                Glassmorphism
                CSS Animations
            JavaScript ES6+
                Modules IIFE Pattern
                Fetch API
                MediaRecorder API
                Geolocation API
            Leaflet.js
                OpenStreetMap Tiles
            Google Fonts
                Inter
        Backend
            Python 3.11+
            FastAPI
                Pydantic v2
                CORS Middleware
                Static File Serving
            Uvicorn
                ASGI Server
                Hot Reload
            aiosqlite
                Async SQLite
            digipin
                India Post Algorithm
                PyPI Package
        Storage
            SQLite
                emergencies table
                events table
                locations table
                audio_files table
            File System
                WebM audio files
        APIs
            REST Endpoints
                POST create emergency
                POST update location
                POST upload audio
                GET stream audio
                PATCH update status
                GET list emergencies
                GET single emergency
```
