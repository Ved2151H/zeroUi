/**
 * Leaflet Map Module for Dashboard
 * =================================
 * Manages the OpenStreetMap view with custom emergency markers.
 */

const MapModule = (() => {
    // Default center: Chhatrapati Sambhajinagar
    const DEFAULT_CENTER = [19.8762, 75.3433];
    const DEFAULT_ZOOM = 13;

    let map = null;
    let markers = {};         // emergencyId → marker
    let markerLayer = null;

    function createMarkerIcon(status) {
        let className = 'marker-resolved';
        if (status === 'emergency') className = 'marker-emergency';
        else if (status === 'verifying') className = 'marker-verifying';

        return L.divIcon({
            className: className,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -16]
        });
    }

    function createPopupContent(emergency) {
        const mapsUrl = `https://www.google.com/maps?q=${emergency.latitude},${emergency.longitude}`;
        return `
            <div class="popup-content">
                <div class="popup-user">${emergency.user_id}</div>
                <div class="popup-row">Status: <strong>${emergency.status.toUpperCase()}</strong></div>
                <div class="popup-row">Trigger: ${emergency.trigger_type}</div>
                <div class="popup-row">DigiPIN: <span class="popup-digipin">${emergency.digipin}</span></div>
                <div class="popup-row">Coords: ${emergency.latitude.toFixed(6)}, ${emergency.longitude.toFixed(6)}</div>
                <div class="popup-row"><a href="${mapsUrl}" target="_blank" style="color:#5dade2;">Open in Google Maps ↗</a></div>
            </div>
        `;
    }

    return {
        init() {
            map = L.map('mapContainer', {
                center: DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                zoomControl: true,
                attributionControl: true
            });

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(map);

            markerLayer = L.layerGroup().addTo(map);
        },

        /**
         * Update all markers based on emergency list.
         * @param {Array} emergencies
         */
        updateMarkers(emergencies) {
            // Track which IDs are still active
            const activeIds = new Set();

            emergencies.forEach(em => {
                activeIds.add(em.id);
                const icon = createMarkerIcon(em.status);

                if (markers[em.id]) {
                    // Update existing marker
                    markers[em.id].setLatLng([em.latitude, em.longitude]);
                    markers[em.id].setIcon(icon);
                    markers[em.id].setPopupContent(createPopupContent(em));
                } else {
                    // Create new marker
                    const marker = L.marker([em.latitude, em.longitude], { icon })
                        .addTo(markerLayer)
                        .bindPopup(createPopupContent(em));
                    
                    marker.on('click', () => {
                        if (typeof showDetail === 'function') {
                            showDetail(em.id);
                        }
                    });

                    markers[em.id] = marker;
                }
            });

            // Remove markers for emergencies no longer in the list
            Object.keys(markers).forEach(id => {
                if (!activeIds.has(parseInt(id))) {
                    markerLayer.removeLayer(markers[id]);
                    delete markers[id];
                }
            });
        },

        /**
         * Focus map on a specific emergency.
         */
        focusOn(lat, lng, zoom = 16) {
            if (map) {
                map.flyTo([lat, lng], zoom, { duration: 1 });
            }
        },

        /**
         * Auto-center on the most recent active emergency.
         */
        autoFocus(emergencies) {
            const active = emergencies.find(e => e.status === 'emergency');
            if (active) {
                this.focusOn(active.latitude, active.longitude, 15);
            }
        },

        /**
         * Force map to recalculate its size (needed when container resizes).
         */
        invalidateSize() {
            if (map) {
                setTimeout(() => map.invalidateSize(), 100);
            }
        }
    };
})();
