/**
 * Emergency Mode Logic
 * ====================
 * Handles SOS activation, GPS tracking, live location updates,
 * and backend communication. DigiPIN is generated server-side
 * using the official India Post algorithm.
 */

const EmergencyModule = (() => {
    // ── Config ──
    const LOCATION_UPDATE_INTERVAL = 30000; // 30 seconds
    const API_BASE = '';  // Same origin

    // Default location: Chhatrapati Sambhajinagar (Aurangabad)
    const DEFAULT_LAT = 19.8762;
    const DEFAULT_LNG = 75.3433;

    // ── State ──
    let emergencyId = null;
    let locationIntervalId = null;
    let currentLat = DEFAULT_LAT;
    let currentLng = DEFAULT_LNG;

    // ── GPS ──
    async function getCurrentPosition() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                // Fallback with slight randomization for demo
                resolve({
                    lat: DEFAULT_LAT + (Math.random() - 0.5) * 0.002,
                    lng: DEFAULT_LNG + (Math.random() - 0.5) * 0.002
                });
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    resolve({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude
                    });
                },
                () => {
                    // Permission denied or error — use default with jitter
                    resolve({
                        lat: DEFAULT_LAT + (Math.random() - 0.5) * 0.002,
                        lng: DEFAULT_LNG + (Math.random() - 0.5) * 0.002
                    });
                },
                { enableHighAccuracy: true, timeout: 5000 }
            );
        });
    }

    function getGoogleMapsLink(lat, lng) {
        return `https://www.google.com/maps?q=${lat},${lng}`;
    }

    // ── Backend Communication ──
    async function sendEmergency(userId, triggerType, eventLogs) {
        const pos = await getCurrentPosition();
        currentLat = pos.lat;
        currentLng = pos.lng;

        const payload = {
            user_id: userId,
            latitude: pos.lat,
            longitude: pos.lng,
            trigger_type: triggerType,
            status: "emergency",
            event_logs: eventLogs
        };

        try {
            const resp = await fetch(`${API_BASE}/api/emergency`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            emergencyId = data.id;

            return {
                id: emergencyId,
                lat: pos.lat,
                lng: pos.lng,
                digipin: data.digipin || '—',
                mapsLink: getGoogleMapsLink(pos.lat, pos.lng)
            };
        } catch (err) {
            console.error('Failed to send emergency:', err);
            // Still return local data so UI can update
            return {
                id: null,
                lat: pos.lat,
                lng: pos.lng,
                digipin: '—',
                mapsLink: getGoogleMapsLink(pos.lat, pos.lng)
            };
        }
    }

    async function sendLocationUpdate() {
        if (!emergencyId) return;

        const pos = await getCurrentPosition();
        // Simulate slight movement for demo
        currentLat = pos.lat + (Math.random() - 0.5) * 0.0005;
        currentLng = pos.lng + (Math.random() - 0.5) * 0.0005;

        try {
            const resp = await fetch(`${API_BASE}/api/emergency/${emergencyId}/location`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: currentLat,
                    longitude: currentLng,
                    timestamp: new Date().toISOString()
                })
            });
            const data = await resp.json();
            // DigiPIN is returned by the backend
            if (data.digipin) {
                const digipinDisplay = document.getElementById('digipinDisplay');
                if (digipinDisplay) {
                    digipinDisplay.textContent = data.digipin;
                }
            }
        } catch (err) {
            console.error('Location update failed:', err);
        }
    }

    // ── Public API ──
    return {
        /**
         * Activate emergency mode.
         * @param {string} userId
         * @param {string} triggerType - "fall" or "manual"
         * @param {Array} eventLogs - Array of {event_type, description, timestamp}
         * @returns {Object} Emergency info {id, lat, lng, digipin, mapsLink}
         */
        async activate(userId, triggerType, eventLogs) {
            const info = await sendEmergency(userId, triggerType, eventLogs);

            // Start periodic location updates
            locationIntervalId = setInterval(sendLocationUpdate, LOCATION_UPDATE_INTERVAL);

            // Start audio recording (skip if already recording from verification phase)
            if (!AudioModule.isActive()) {
                const audioStarted = await AudioModule.startRecording();
                if (!audioStarted) {
                    console.warn('Audio recording not available — continuing without audio');
                }
            }

            // Prevent accidental page close
            window.onbeforeunload = (e) => {
                e.preventDefault();
                e.returnValue = 'Emergency mode is active. Are you sure you want to leave?';
            };

            return info;
        },

        /**
         * Deactivate emergency mode and clean up.
         */
        async deactivate() {
            // Stop location updates
            if (locationIntervalId) {
                clearInterval(locationIntervalId);
                locationIntervalId = null;
            }

            // Stop and upload audio
            const audioBlob = await AudioModule.stopRecording();
            if (audioBlob && emergencyId) {
                await AudioModule.uploadAudio(emergencyId, audioBlob);
            }

            // Update status to resolved
            if (emergencyId) {
                try {
                    await fetch(`${API_BASE}/api/emergency/${emergencyId}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'resolved' })
                    });
                } catch (err) {
                    console.error('Failed to update status:', err);
                }
            }

            // Remove exit protection
            window.onbeforeunload = null;

            const resolvedId = emergencyId;
            emergencyId = null;
            return resolvedId;
        },

        getEmergencyId() {
            return emergencyId;
        },

        getPosition() {
            return { lat: currentLat, lng: currentLng };
        }
    };
})();

