/**
 * Accelerometer Simulation & Fall Detection
 * ==========================================
 * Generates simulated sensor data and implements rule-based fall detection:
 *   1. Detect a spike > threshold (sudden impact)
 *   2. Followed by near-zero readings for 2-3 seconds (inactivity)
 */

const SensorModule = (() => {
    // ── Config ──
    const SPIKE_THRESHOLD = 25;       // m/s² — fall impact threshold
    const INACTIVITY_THRESHOLD = 2;   // m/s² — near-zero movement
    const INACTIVITY_DURATION = 2500; // ms — how long user must be still
    const NOISE_BASE = 0.5;          // Baseline sensor noise amplitude
    const UPDATE_INTERVAL = 100;     // ms between sensor readings

    // ── State ──
    let intervalId = null;
    let currentAccel = 9.8;           // Normal gravity
    let spikeDetected = false;
    let inactivityStart = null;
    let simulatingFall = false;
    let fallPhase = 'none';           // none | spike | inactivity
    let onFallDetected = null;

    // ── DOM refs ──
    const accelBar = document.getElementById('accelBar');
    const accelValue = document.getElementById('accelValue');
    const sensorStatus = document.getElementById('sensorStatus');

    function generateNoise() {
        return (Math.random() - 0.5) * NOISE_BASE * 2;
    }

    function updateDisplay(value) {
        if (!accelBar || !accelValue) return;
        
        // Map acceleration to bar width (0-50 m/s² → 0-100%)
        const pct = Math.min(100, (Math.abs(value) / 50) * 100);
        accelBar.style.width = pct + '%';
        accelValue.textContent = value.toFixed(2) + ' m/s²';

        if (value > SPIKE_THRESHOLD) {
            accelBar.classList.add('spike');
        } else {
            accelBar.classList.remove('spike');
        }
    }

    function tick() {
        if (simulatingFall) {
            switch (fallPhase) {
                case 'spike':
                    // Generate a sharp spike (30-45 m/s²)
                    currentAccel = 30 + Math.random() * 15;
                    spikeDetected = true;
                    fallPhase = 'post-spike';
                    updateSensorStatus('⚡ Impact Detected', 'alert');
                    break;

                case 'post-spike':
                    // Quick decrease after impact
                    currentAccel = 5 + Math.random() * 3;
                    fallPhase = 'inactivity';
                    inactivityStart = Date.now();
                    updateSensorStatus('📉 Monitoring movement...', 'alert');
                    break;

                case 'inactivity':
                    // Near-zero movement
                    currentAccel = 0.3 + Math.random() * 0.5;
                    
                    if (inactivityStart && Date.now() - inactivityStart >= INACTIVITY_DURATION) {
                        // Fall confirmed!
                        fallPhase = 'confirmed';
                        simulatingFall = false;
                        updateSensorStatus('🚨 Fall Confirmed', 'alert');
                        if (onFallDetected) onFallDetected();
                    }
                    break;
            }
        } else {
            // Normal passive mode — slight variations around gravity
            currentAccel = 9.8 + generateNoise();
        }

        updateDisplay(currentAccel);
    }

    function updateSensorStatus(text, type) {
        if (!sensorStatus) return;
        sensorStatus.textContent = text;
        sensorStatus.className = 'sensor-status ' + type;
    }

    // ── Public API ──
    return {
        start(callback) {
            onFallDetected = callback;
            intervalId = setInterval(tick, UPDATE_INTERVAL);
        },

        stop() {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        },

        simulateFall() {
            simulatingFall = true;
            fallPhase = 'spike';
            spikeDetected = false;
            inactivityStart = null;
        },

        reset() {
            simulatingFall = false;
            fallPhase = 'none';
            spikeDetected = false;
            inactivityStart = null;
            currentAccel = 9.8;
            updateSensorStatus('All Clear', 'safe');
        },

        getCurrentAccel() {
            return currentAccel;
        }
    };
})();
