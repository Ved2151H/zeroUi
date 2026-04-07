/**
 * Zero UI Emergency App — Main State Machine
 * ============================================
 * Orchestrates the three modes: PASSIVE → VERIFYING → EMERGENCY
 * 
 * State transitions:
 *   PASSIVE  →  Fall detected  →  VERIFYING
 *   PASSIVE  →  Triple press   →  EMERGENCY (instant)
 *   VERIFYING → User responds  →  PASSIVE
 *   VERIFYING → No response    →  EMERGENCY
 *   EMERGENCY → Resolved       →  PASSIVE
 */

(() => {
    // ── Constants ──
    const VERIFY_COUNTDOWN = 8; // seconds
    const CIRCUMFERENCE = 2 * Math.PI * 52; // SVG circle circumference

    // ── State ──
    let currentState = 'PASSIVE';
    let countdownTimer = null;
    let countdownRemaining = VERIFY_COUNTDOWN;
    let eventLog = []; // Accumulated events for this session

    // ── DOM Refs ──
    const views = {
        passive: document.getElementById('passiveView'),
        verify: document.getElementById('verifyView'),
        emergency: document.getElementById('emergencyView')
    };

    const countdownCircle = document.getElementById('countdownCircle');
    const countdownNumber = document.getElementById('countdownNumber');
    const gpsCoords = document.getElementById('gpsCoords');
    const digipinDisplay = document.getElementById('digipinDisplay');
    const mapsLink = document.getElementById('mapsLink');
    const eventTimeline = document.getElementById('eventTimeline');
    const systemLog = document.getElementById('systemLog');

    // Control buttons
    const btnSimulateFall = document.getElementById('btnSimulateFall');
    const btnTriplePress = document.getElementById('btnTriplePress');
    const btnRespondOk = document.getElementById('btnRespondOk');
    const btnResolve = document.getElementById('btnResolve');

    // ── Initialization ──
    function init() {
        // Set up countdown circle
        if (countdownCircle) {
            countdownCircle.style.strokeDasharray = CIRCUMFERENCE;
            countdownCircle.style.strokeDashoffset = 0;
        }

        // Start sensor monitoring
        SensorModule.start(onFallDetected);

        // Update button states
        updateButtons();

        log('🟢 System initialized — Passive mode active', 'success');
    }

    // ── State Transition ──
    function switchView(state) {
        // Hide all views
        Object.values(views).forEach(v => v.classList.remove('active'));

        switch (state) {
            case 'PASSIVE':
                views.passive.classList.add('active');
                break;
            case 'VERIFYING':
                views.verify.classList.add('active');
                break;
            case 'EMERGENCY':
                views.emergency.classList.add('active');
                break;
        }

        currentState = state;
        updateButtons();
    }

    function updateButtons() {
        btnSimulateFall.disabled = currentState !== 'PASSIVE';
        btnTriplePress.disabled = currentState !== 'PASSIVE';
        btnRespondOk.disabled = currentState !== 'VERIFYING';
        btnResolve.disabled = currentState !== 'EMERGENCY';
    }

    // ── Event Logging ──
    function addEvent(type, description, dotClass = '') {
        const timestamp = new Date().toISOString();
        eventLog.push({ event_type: type, description, timestamp });
        
        // Add to phone timeline
        if (eventTimeline) {
            const entry = document.createElement('div');
            entry.className = 'timeline-entry';
            entry.innerHTML = `
                <div class="timeline-dot ${dotClass}"></div>
                <div class="timeline-text">${description}</div>
                <div class="timeline-time">${new Date().toLocaleTimeString()}</div>
            `;
            eventTimeline.prepend(entry);
        }
    }

    function log(message, type = '') {
        if (!systemLog) return;
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        systemLog.prepend(entry);

        // Keep log manageable
        while (systemLog.children.length > 50) {
            systemLog.removeChild(systemLog.lastChild);
        }
    }

    // ── Fall Detection Callback ──
    function onFallDetected() {
        if (currentState !== 'PASSIVE') return;

        log('⚠️ Fall detected — initiating verification', 'warn');
        addEvent('fall_detected', 'Fall detected — sudden impact followed by inactivity', 'emergency');
        addEvent('no_movement', 'No movement detected for 2.5 seconds', 'verify');

        enterVerifying();
    }

    // ── VERIFYING Mode ──
    async function enterVerifying() {
        addEvent('verification_started', 'Verification started — "Are you okay?"', 'verify');
        log('🎤 Microphone activated temporarily for verification', 'warn');

        // Start audio recording NOW — captures the verification phase
        const micStarted = await AudioModule.startRecording();
        if (micStarted) {
            addEvent('mic_activated', 'Microphone recording started for verification', 'verify');
            log('🎤 Recording started — capturing verification audio', 'warn');
        } else {
            log('⚠️ Microphone unavailable — continuing without audio', 'warn');
        }

        switchView('VERIFYING');
        countdownRemaining = VERIFY_COUNTDOWN;
        updateCountdown();

        countdownTimer = setInterval(() => {
            countdownRemaining--;
            updateCountdown();

            if (countdownRemaining <= 0) {
                clearInterval(countdownTimer);
                countdownTimer = null;
                
                addEvent('no_response', 'No response from user — escalating to emergency', 'emergency');
                log('🚨 No response — activating Emergency Mode', 'error');
                
                enterEmergency('fall');
            }
        }, 1000);
    }

    function updateCountdown() {
        if (countdownNumber) {
            countdownNumber.textContent = countdownRemaining;
        }
        if (countdownCircle) {
            const progress = (1 - countdownRemaining / VERIFY_COUNTDOWN) * CIRCUMFERENCE;
            countdownCircle.style.strokeDashoffset = progress;
        }
    }

    // ── EMERGENCY Mode ──
    async function enterEmergency(triggerType) {
        addEvent('emergency_triggered', `Emergency triggered via ${triggerType === 'manual' ? 'manual panic button' : 'fall detection + no response'}`, 'emergency');
        
        switchView('EMERGENCY');
        log('🆘 Emergency Mode ACTIVE — sending SOS', 'error');

        const userId = document.getElementById('userId').value || 'user_001';

        // Activate emergency module
        const info = await EmergencyModule.activate(userId, triggerType, eventLog);

        // Update UI
        if (gpsCoords) {
            gpsCoords.textContent = `${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}`;
        }
        if (digipinDisplay) {
            digipinDisplay.textContent = info.digipin;
        }
        if (mapsLink) {
            mapsLink.href = info.mapsLink;
        }

        addEvent('sos_sent', `SOS alert sent to backend (ID: ${info.id || 'pending'})`, 'emergency');
        addEvent('gps_acquired', `GPS location: ${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}`, 'safe');
        addEvent('digipin_generated', `DigiPIN: ${info.digipin}`, 'safe');
        addEvent('audio_started', 'Audio recording started', 'verify');
        addEvent('location_tracking', 'Live location updates started (every 30s)', 'safe');

        log(`📍 GPS: ${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}`, 'error');
        log(`🔢 DigiPIN: ${info.digipin}`, 'error');
        log(`🗺️ Maps: ${info.mapsLink}`, 'error');
    }

    // ── Global Functions (called from HTML onclick) ──

    // Simulate a fall event
    window.simulateFall = function() {
        if (currentState !== 'PASSIVE') return;
        log('📉 Simulating fall event...', 'warn');
        SensorModule.simulateFall();
    };

    // Simulate triple power button press
    window.simulateTriplePress = function() {
        if (currentState !== 'PASSIVE') return;
        log('🔴 Triple power press detected — IMMEDIATE emergency', 'error');
        addEvent('manual_trigger', 'Power button pressed 3 times — manual panic trigger', 'emergency');
        eventLog = [{ event_type: 'manual_trigger', description: 'Power button pressed 3 times — manual panic trigger', timestamp: new Date().toISOString() }];
        enterEmergency('manual');
    };

    // User responds "I'm okay" during verification
    window.respondOk = async function() {
        if (currentState !== 'VERIFYING') return;

        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }

        // Stop and discard verification recording — user is safe
        if (AudioModule.isActive()) {
            await AudioModule.stopRecording(); // discard the blob
            log('🎤 Recording stopped — user is safe', 'success');
        }

        addEvent('user_responded', 'User responded — "I\'m okay"', 'safe');
        log('✅ User responded — returning to passive mode', 'success');

        SensorModule.reset();
        eventLog = [];
        switchView('PASSIVE');
    };

    // Resolve an active emergency
    window.resolveEmergency = async function() {
        if (currentState !== 'EMERGENCY') return;

        log('🏁 Resolving emergency...', 'success');
        addEvent('emergency_resolved', 'Emergency resolved by user', 'safe');

        await EmergencyModule.deactivate();
        SensorModule.reset();
        eventLog = [];

        // Clear timeline
        if (eventTimeline) eventTimeline.innerHTML = '';

        log('✅ Emergency resolved — returning to passive mode', 'success');
        switchView('PASSIVE');
    };

    // ── Boot ──
    init();
})();
