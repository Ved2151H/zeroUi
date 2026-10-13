/**
 * Leaflet map module
 * ==================
 * Status-aware markers, a selection highlight with a device label, and the
 * location track of the selected emergency.
 *
 * Base tiles follow the console theme: the dark console gets a dark basemap,
 * the light console gets a light one. The Dark / Satellite / Terrain buttons
 * are explicit overrides on top of that.
 *
 * Public API used by app.js:
 *   init · updateMarkers · setSelected · drawTrack · clearTrack · focusOn
 *   fitToTrack · fitAll · autoFocus · invalidateSize
 *   setTheme · setBaseLayer · zoomBy · setTrackVisible
 */

const MapModule = (() => {
    const DEFAULT_CENTER = [19.8762, 75.3433];   // Chhatrapati Sambhajinagar
    const DEFAULT_ZOOM = 12;
    // Seconds for a focus flight. This is the CSS --t-map token: a map move is
    // the longest motion in the console because it is the operator's own
    // spatial reorientation, but it still has to land well inside a second.
    //
    // Leaflet animates its own way, outside the stylesheet, so the global
    // reduced-motion guard cannot reach it: a zero duration makes the focus an
    // instant jump, which is the same information without the travel.
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const FLY_SECONDS = REDUCED ? 0 : 0.42;

    // Keyless basemaps only. The previous dark source (CARTO) began returning
    // an "API KEY REQUIRED" placeholder image instead of map tiles, which left
    // the operations map as a blank field for an operator.
    //
    // `dark` is Esri's dark grey canvas base, darkened further and paired with
    // the matching transparent place-name overlay drawn above it. The canvas
    // was chosen over satellite imagery after measuring both: imagery at this
    // zoom is almost featureless once dimmed to the console's night level,
    // whereas the canvas keeps a legible street fabric and is 2.6x brighter to
    // start with, so it survives the same dimming with its roads intact.
    const TILES = {
        dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        light: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        terrain: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    };
    // Transparent overlays drawn above the base tiles: place names, road
    // shields and boundaries only, no background fill.
    const LABELS = {
        dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    };
    // Leaflet puts `className` on the layer's container, not on each tile, so
    // these are the hooks realtime.css filters by.
    const BASE_CLASS = { dark: 'tiles-darken' };
    const LABEL_CLASS = { dark: 'tiles-labels' };
    const ATTRIBUTION = {
        dark: 'Esri, HERE, Garmin, OpenStreetMap contributors',
        light: 'Esri, HERE, Garmin, OpenStreetMap contributors',
        satellite: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
        terrain: '&copy; OpenStreetMap &copy; OpenTopoMap',
    };
    const MAX_ZOOM = { dark: 19, light: 19, satellite: 19, terrain: 17 };
    // ArcGIS canvas layers stop at z16; above that Leaflet upscales instead of
    // requesting tiles that do not exist.
    const NATIVE_ZOOM = { dark: 16, light: 16, satellite: 19, terrain: 17 };

    let map = null;
    let tileLayer = null;
    let labelLayer = null;
    let markerLayer = null;
    let trackLayer = null;
    let markers = {};
    let labelMarker = null;
    let selectedId = null;
    let currentType = null;
    let hasAutoFocused = false;

    function iconClass(emergency) {
        if (emergency.connection_state === 'stale' && emergency.status === 'emergency') return 'marker-stale';
        if (emergency.status === 'emergency') return 'marker-emergency';
        if (emergency.status === 'verifying') return 'marker-verifying';
        if (emergency.status === 'cancelled') return 'marker-cancelled';
        return 'marker-resolved';
    }

    function createMarkerIcon(emergency, selected) {
        return L.divIcon({
            className: `${iconClass(emergency)}${selected ? ' marker-selected' : ''}`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -16],
        });
    }

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value === null || value === undefined ? '' : String(value);
        return div.innerHTML;
    }

    // India Post, the issuing authority for DIGIPIN, serves one page per code.
    const DIGIPIN_LOOKUP = 'https://dac.indiapost.gov.in/mydigipin/home/';

    function popupContent(emergency) {
        const mapsUrl = `https://www.google.com/maps?q=${emergency.latitude},${emergency.longitude}`;
        const digipinLookup = emergency.digipin
            ? `${DIGIPIN_LOOKUP}${encodeURIComponent(emergency.digipin)}`
            : null;
        return `
            <div class="popup-content">
                <div class="popup-user">${escapeHtml(emergency.user_id)}</div>
                <div class="popup-row">Status: <strong>${escapeHtml(String(emergency.status).toUpperCase())}</strong>
                    · ${escapeHtml(String(emergency.connection_state).toUpperCase())}</div>
                <div class="popup-row">Trigger: ${escapeHtml(emergency.trigger_type)}</div>
                <div class="popup-row">DIGIPIN: ${digipinLookup
                    ? `<a class="popup-digipin" href="${digipinLookup}" target="_blank" rel="noopener noreferrer">${escapeHtml(emergency.digipin)}</a>`
                    : `<span class="popup-digipin">unavailable</span>`}</div>
                <div class="popup-row">Coords: ${Number(emergency.latitude).toFixed(6)}, ${Number(emergency.longitude).toFixed(6)}</div>
                <div class="popup-row">ID: <code>${escapeHtml(emergency.emergency_id)}</code></div>
                <div class="popup-row"><a href="${mapsUrl}" target="_blank" rel="noopener">Open in Google Maps</a></div>
            </div>
        `;
    }

    function applyTile(type, dark) {
        if (!map) return;
        const key = type || (dark ? 'dark' : 'light');
        if (currentType === key && tileLayer) return;
        currentType = key;
        if (tileLayer) map.removeLayer(tileLayer);
        if (labelLayer) { map.removeLayer(labelLayer); labelLayer = null; }

        tileLayer = L.tileLayer(TILES[key], {
            attribution: ATTRIBUTION[key],
            maxZoom: MAX_ZOOM[key],
            maxNativeZoom: NATIVE_ZOOM[key],
            crossOrigin: true,
            className: BASE_CLASS[key] || '',
        }).addTo(map);
        tileLayer.setZIndex(0);

        if (LABELS[key]) {
            labelLayer = L.tileLayer(LABELS[key], {
                maxZoom: MAX_ZOOM[key],
                maxNativeZoom: NATIVE_ZOOM[key],
                crossOrigin: true,
                className: LABEL_CLASS[key] || '',
            }).addTo(map);
            labelLayer.setZIndex(1);
        }
    }

    /** Draw the pill label that sits above the selected device. */
    function updateLabel(emergency) {
        if (labelMarker) {
            trackLayer.removeLayer(labelMarker);
            labelMarker = null;
        }
        if (!emergency || emergency.latitude === null || emergency.longitude === null) return;
        const labelIcon = L.divIcon({
            className: 'marker-label-wrap',
            html: `<span class="marker-label">${escapeHtml(emergency.user_id)}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        });
        labelMarker = L.marker([emergency.latitude, emergency.longitude], {
            icon: labelIcon,
            interactive: false,
            zIndexOffset: 1000,
        }).addTo(trackLayer);
    }

    return {
        init() {
            // Idempotent: boot() runs again after every sign-in, and Leaflet
            // throws "Map container is already initialized" on a second init.
            if (map) {
                map.invalidateSize();
                return map;
            }
            const dark = document.documentElement.getAttribute('data-theme') === 'dark';
            map = L.map('mapContainer', {
                center: DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                zoomControl: false,          // custom controls live in the map chrome
                attributionControl: true,
            });
            applyTile(null, dark);
            markerLayer = L.layerGroup().addTo(map);
            trackLayer = L.layerGroup().addTo(map);
            return map;
        },

        /** Follow the console theme (explicit button choice still wins until then). */
        setTheme(isDark) {
            applyTile(null, isDark);
            return isDark ? 'dark' : null;
        },

        setBaseLayer(type) {
            applyTile(type, document.documentElement.getAttribute('data-theme') === 'dark');
        },

        updateMarkers(emergencies) {
            const alive = new Set();
            let selected = null;

            emergencies.forEach((emergency) => {
                if (emergency.latitude === null || emergency.longitude === null) return;
                alive.add(emergency.emergency_id);
                const isSelected = emergency.emergency_id === selectedId;
                if (isSelected) selected = emergency;

                const icon = createMarkerIcon(emergency, isSelected);
                const latlng = [emergency.latitude, emergency.longitude];

                if (markers[emergency.emergency_id]) {
                    markers[emergency.emergency_id].setLatLng(latlng);
                    markers[emergency.emergency_id].setIcon(icon);
                    markers[emergency.emergency_id].setPopupContent(popupContent(emergency));
                } else {
                    const marker = L.marker(latlng, { icon })
                        .addTo(markerLayer)
                        .bindPopup(popupContent(emergency));
                    marker.on('click', () => {
                        if (typeof window.showDetail === 'function') {
                            window.showDetail(emergency.emergency_id);
                        }
                    });
                    markers[emergency.emergency_id] = marker;
                }
            });

            Object.keys(markers).forEach((id) => {
                if (!alive.has(id)) {
                    markerLayer.removeLayer(markers[id]);
                    delete markers[id];
                }
            });

            updateLabel(selected);
        },

        setSelected(emergencyId) {
            selectedId = emergencyId;
            if (!emergencyId) updateLabel(null);
        },

        /** Draw the location track of the selected emergency only. */
        drawTrack(locations, status) {
            const wasVisible = trackLayer && trackLayer.getLayers().length >= 0;
            if (!trackLayer) return;
            trackLayer.clearLayers();
            labelMarker = null;
            if (!wasVisible) return;

            const points = (locations || [])
                .filter((l) => l.latitude !== null && l.longitude !== null)
                .map((l) => [l.latitude, l.longitude]);
            if (points.length === 0) return;

            // Track colour follows the console's status tokens, so the map and
            // the queue never disagree about what red, amber and green mean.
            const color = status === 'emergency' ? '#cd5a54'
                : (status === 'cancelled' ? '#c9932f' : '#5b9c6e');

            if (points.length > 1) {
                L.polyline(points, { color, weight: 3, opacity: 0.85, dashArray: '6 6' })
                    .addTo(trackLayer);
            }
            L.circleMarker(points[0], {
                radius: 5, color, weight: 2, fillColor: color, fillOpacity: 0.5,
            }).bindTooltip('First known position').addTo(trackLayer);
            L.circleMarker(points[points.length - 1], {
                radius: 7, color: '#f0eee9', weight: 2, fillColor: color, fillOpacity: 0.95,
            }).bindTooltip('Latest position').addTo(trackLayer);
        },

        clearTrack() {
            if (!trackLayer) return;
            trackLayer.clearLayers();
            labelMarker = null;
        },

        setTrackVisible(visible, locations, status) {
            if (!trackLayer) return;
            if (visible) this.drawTrack(locations, status);
            else this.clearTrack();
        },

        focusOn(lat, lng, zoom = 16) {
            if (map) map.flyTo([lat, lng], zoom, { duration: FLY_SECONDS });
        },

        zoomBy(delta) {
            if (map) map.setZoom(map.getZoom() + delta);
        },

        fitToTrack(locations) {
            if (!map || !locations || locations.length === 0) return;
            const bounds = L.latLngBounds(locations.map((l) => [l.latitude, l.longitude]));
            map.fitBounds(bounds.pad(0.25), { maxZoom: 17 });
        },

        fitAll(emergencies) {
            if (!map) return;
            const points = (emergencies || [])
                .filter((e) => e.latitude !== null && e.longitude !== null)
                .map((e) => [e.latitude, e.longitude]);
            if (points.length === 0) return;
            if (points.length === 1) { map.flyTo(points[0], 15, { duration: FLY_SECONDS }); return; }
            map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 16 });
        },

        /** Auto-centre once on the newest active emergency, then stay put. */
        autoFocus(emergencies) {
            if (hasAutoFocused) return;
            const active = emergencies.find((e) => e.status === 'emergency');
            if (active && active.latitude !== null) {
                hasAutoFocused = true;
                this.focusOn(active.latitude, active.longitude, 15);
            }
        },

        invalidateSize() {
            if (map) setTimeout(() => map.invalidateSize(), 100);
        },
    };
})();
