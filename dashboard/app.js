/**
 * Dashboard App — Main Logic
 * ===========================
 * Polls the backend for emergencies, renders cards, manages detail view,
 * and plays notification sounds on new events.
 *
 * IMPORTANT: The detail panel uses smart diffing to avoid re-rendering
 * when data hasn't changed. This prevents flickering and ensures audio
 * playback is never interrupted by polling updates.
 */

(() => {
    // ── Config ──
    const POLL_INTERVAL = 5000;  // 5 seconds
    const API_BASE = '';          // Same origin

    // ── State ──
    let emergencies = [];
    let selectedId = null;
    let currentFilter = 'all';
    let knownIds = new Set();
    let isFirstLoad = true;

    // Change-tracking for detail panel to avoid unnecessary re-renders
    let lastDetailHash = '';
    let lastTimelineCount = 0;
    let lastDetailStatus = '';
    let currentAudioEmergencyId = null;

    // ── DOM Refs ──
    const emergenciesList = document.getElementById('emergenciesList');
    const emptyState = document.getElementById('emptyState');
    const activeCountValue = document.getElementById('activeCountValue');
    const verifyingCountValue = document.getElementById('verifyingCountValue');
    const resolvedCountValue = document.getElementById('resolvedCountValue');
    const detailOverlay = document.getElementById('detailOverlay');
    const notifSound = document.getElementById('notifSound');

    // Detail refs
    const detailStatusBadge = document.getElementById('detailStatusBadge');
    const detailUser = document.getElementById('detailUser');
    const detailTime = document.getElementById('detailTime');
    const detailTrigger = document.getElementById('detailTrigger');
    const detailDigipin = document.getElementById('detailDigipin');
    const detailCoords = document.getElementById('detailCoords');
    const detailMapsLink = document.getElementById('detailMapsLink');
    const detailTimeline = document.getElementById('detailTimeline');
    const audioSection = document.getElementById('audioSection');
    const audioPlayer = document.getElementById('audioPlayer');
    const btnDetailResolve = document.getElementById('btnDetailResolve');

    // ── Initialize ──
    function init() {
        MapModule.init();
        pollEmergencies();
        setInterval(pollEmergencies, POLL_INTERVAL);
    }

    // ── Polling ──
    async function pollEmergencies() {
        try {
            const resp = await fetch(`${API_BASE}/api/emergencies`);
            const data = await resp.json();
            emergencies = data.emergencies || [];

            // Check for new emergencies
            if (!isFirstLoad) {
                emergencies.forEach(em => {
                    if (!knownIds.has(em.id) && em.status === 'emergency') {
                        playNotification();
                    }
                });
            }

            // Update known IDs
            knownIds = new Set(emergencies.map(em => em.id));
            isFirstLoad = false;

            updateUI();

            // Auto-focus on first load if there are active emergencies
            if (emergencies.some(e => e.status === 'emergency')) {
                MapModule.autoFocus(emergencies);
            }
        } catch (err) {
            console.error('Failed to poll emergencies:', err);
        }
    }

    function playNotification() {
        if (notifSound) {
            notifSound.currentTime = 0;
            notifSound.play().catch(() => {});
        }
    }

    // ── Compute a lightweight hash of emergency data for change detection ──
    function computeDetailHash(em) {
        return `${em.id}|${em.status}|${em.latitude.toFixed(6)}|${em.longitude.toFixed(6)}|${em.digipin}|${(em.events || []).length}|${em.has_audio}`;
    }

    // ── UI Update ──
    function updateUI() {
        updateCounts();
        renderCards();
        MapModule.updateMarkers(emergencies);

        // Smart-refresh detail panel: only update if data actually changed
        if (selectedId !== null) {
            const em = emergencies.find(e => e.id === selectedId);
            if (em) {
                const newHash = computeDetailHash(em);
                if (newHash !== lastDetailHash) {
                    renderDetail(em, false); // false = background poll update
                }
                // Always keep live-updating fields fresh (cheap text updates, no flicker)
                detailTime.textContent = `Created ${getTimeAgo(em.created_at)} • ${new Date(em.created_at).toLocaleString()}`;
                detailCoords.textContent = `${em.latitude.toFixed(6)}, ${em.longitude.toFixed(6)}`;
                detailDigipin.textContent = em.digipin;
                const mapsUrl = `https://www.google.com/maps?q=${em.latitude},${em.longitude}`;
                detailMapsLink.href = mapsUrl;
            }
        }
    }

    function updateCounts() {
        const active = emergencies.filter(e => e.status === 'emergency').length;
        const verifying = emergencies.filter(e => e.status === 'verifying').length;
        const resolved = emergencies.filter(e => e.status === 'resolved' || e.status === 'safe').length;

        activeCountValue.textContent = active;
        verifyingCountValue.textContent = verifying;
        resolvedCountValue.textContent = resolved;
    }

    // ── Card Rendering ──
    function renderCards() {
        const filtered = currentFilter === 'all'
            ? emergencies
            : emergencies.filter(e => e.status === currentFilter);

        if (filtered.length === 0) {
            emergenciesList.innerHTML = '';
            emergenciesList.appendChild(createEmptyState());
            return;
        }

        emergenciesList.innerHTML = '';
        filtered.forEach(em => {
            emergenciesList.appendChild(createCard(em));
        });
    }

    function createEmptyState() {
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.innerHTML = `
            <div class="empty-icon">📡</div>
            <p class="empty-text">No emergencies detected</p>
            <p class="empty-sub">System is monitoring for events</p>
        `;
        return div;
    }

    function createCard(em) {
        const card = document.createElement('div');
        card.className = `emergency-card status-${em.status}${em.id === selectedId ? ' active' : ''}`;
        card.onclick = () => showDetail(em.id);

        const triggerLabel = em.trigger_type === 'manual' ? '🔴 Manual' : '📉 Fall';
        const timeAgo = getTimeAgo(em.created_at);

        card.innerHTML = `
            <div class="card-top">
                <span class="card-user">${escapeHtml(em.user_id)}</span>
                <span class="card-status ${em.status}">
                    <span class="status-dot-sm"></span>
                    ${em.status.toUpperCase()}
                </span>
            </div>
            <div class="card-meta">
                <span class="card-meta-item">
                    <span class="card-meta-icon">${em.trigger_type === 'manual' ? '🔴' : '📉'}</span>
                    ${triggerLabel}
                </span>
                <span class="card-meta-item">
                    <span class="card-meta-icon">📍</span>
                    ${em.latitude.toFixed(4)}, ${em.longitude.toFixed(4)}
                </span>
                ${em.has_audio ? '<span class="card-audio-badge">🔊 Audio</span>' : ''}
            </div>
            <div class="card-bottom">
                <span class="card-digipin">${em.digipin}</span>
                <span class="card-time">${timeAgo}</span>
            </div>
        `;

        return card;
    }

    // ── Detail View ──
    window.showDetail = async function(id) {
        // If clicking the same card, don't re-fetch
        if (selectedId === id && detailOverlay.classList.contains('visible')) {
            return;
        }

        selectedId = id;
        lastDetailHash = '';    // Force full render on explicit click
        lastTimelineCount = 0;
        currentAudioEmergencyId = null;

        // Fetch full detail
        try {
            const resp = await fetch(`${API_BASE}/api/emergency/${id}`);
            const em = await resp.json();
            renderDetail(em, true); // true = user-initiated, full render
            detailOverlay.classList.add('visible');

            // Focus map
            MapModule.focusOn(em.latitude, em.longitude, 16);

            // Highlight card
            document.querySelectorAll('.emergency-card').forEach(c => c.classList.remove('active'));
            const cards = document.querySelectorAll('.emergency-card');
            const idx = emergencies.findIndex(e => e.id === id);
            if (cards[idx]) cards[idx].classList.add('active');
        } catch (err) {
            console.error('Failed to fetch emergency detail:', err);
        }
    };

    /**
     * Render the detail panel.
     * @param {Object} em - Emergency data
     * @param {boolean} isUserAction - true if user clicked a card (full render),
     *                                  false if this is a background poll update (incremental)
     */
    function renderDetail(em, isUserAction) {
        const newHash = computeDetailHash(em);

        // Status badge — only update if status changed
        if (lastDetailStatus !== em.status || isUserAction) {
            detailStatusBadge.textContent = em.status.toUpperCase();
            detailStatusBadge.className = `detail-status-badge ${em.status}`;
            lastDetailStatus = em.status;
        }

        // Header — always safe to update (text-only, no flicker)
        if (isUserAction) {
            detailUser.textContent = em.user_id;
        }
        detailTime.textContent = `Created ${getTimeAgo(em.created_at)} • ${new Date(em.created_at).toLocaleString()}`;

        // Grid — only update on user action or data change
        if (isUserAction || newHash !== lastDetailHash) {
            detailTrigger.textContent = em.trigger_type === 'manual' ? '🔴 Manual Panic' : '📉 Fall Detection';
            detailDigipin.textContent = em.digipin;
            detailCoords.textContent = `${em.latitude.toFixed(6)}, ${em.longitude.toFixed(6)}`;
            
            const mapsUrl = `https://www.google.com/maps?q=${em.latitude},${em.longitude}`;
            detailMapsLink.href = mapsUrl;
        }

        // Audio — NEVER touch the audio element while it's playing
        if (em.has_audio) {
            audioSection.style.display = 'block';
            const audioUrl = `${API_BASE}/api/emergency/${em.id}/audio`;
            
            // Only set src if: user explicitly clicked a card (always update),
            // OR audio is not currently playing and we need a new source.
            // Background polls NEVER interrupt active playback.
            const isPlaying = audioPlayer && !audioPlayer.paused;
            const isSameEmergency = currentAudioEmergencyId === em.id;
            
            if (isUserAction || (!isPlaying && !isSameEmergency)) {
                if (isPlaying && isUserAction) {
                    audioPlayer.pause();  // Stop old audio before switching
                }
                audioPlayer.src = audioUrl;
                audioPlayer.load();
                currentAudioEmergencyId = em.id;
            }
        } else {
            audioSection.style.display = 'none';
        }

        // Timeline — use incremental approach: only add new entries
        const events = em.events || [];
        if (isUserAction || lastTimelineCount === 0) {
            // Full rebuild only on user click or first render
            renderTimelineFull(events);
        } else if (events.length > lastTimelineCount) {
            // Append only new events
            const newEvents = events.slice(lastTimelineCount);
            appendTimelineEntries(newEvents);
        }
        lastTimelineCount = events.length;

        // Actions
        if (em.status === 'emergency' || em.status === 'verifying') {
            btnDetailResolve.disabled = false;
            btnDetailResolve.style.display = 'block';
        } else {
            btnDetailResolve.disabled = true;
            btnDetailResolve.style.display = 'none';
        }

        // Update hash
        lastDetailHash = newHash;
    }

    function renderTimelineFull(events) {
        detailTimeline.innerHTML = '';
        events.forEach(ev => {
            detailTimeline.appendChild(createTimelineEntry(ev));
        });
        lastTimelineCount = events.length;
    }

    function appendTimelineEntries(events) {
        events.forEach(ev => {
            const entry = createTimelineEntry(ev);
            entry.classList.add('tl-entry-new');
            detailTimeline.appendChild(entry);
        });
        // Auto-scroll timeline to show newest entry
        detailTimeline.scrollTop = detailTimeline.scrollHeight;
    }

    function createTimelineEntry(ev) {
        const entry = document.createElement('div');
        entry.className = 'tl-entry';

        let dotClass = '';
        const type = ev.event_type || '';
        if (type.includes('emergency') || type.includes('sos') || type.includes('no_response') || type.includes('fall')) {
            dotClass = 'emergency';
        } else if (type.includes('verif') || type.includes('audio') || type.includes('no_movement')) {
            dotClass = 'verifying';
        } else if (type.includes('safe') || type.includes('resolved') || type.includes('gps') || type.includes('location') || type.includes('digipin')) {
            dotClass = 'safe';
        }

        const time = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '';

        entry.innerHTML = `
            <div class="tl-dot ${dotClass}"></div>
            <div class="tl-content">
                <div class="tl-type">${escapeHtml(type.replace(/_/g, ' '))}</div>
                <div class="tl-desc">${escapeHtml(ev.description)}</div>
                <div class="tl-time">${time}</div>
            </div>
        `;

        return entry;
    }

    // ── Actions ──
    window.closeDetail = function() {
        selectedId = null;
        lastDetailHash = '';
        lastTimelineCount = 0;
        lastDetailStatus = '';
        currentAudioEmergencyId = null;

        // Stop audio if playing
        if (audioPlayer && !audioPlayer.paused) {
            audioPlayer.pause();
        }

        detailOverlay.classList.remove('visible');
        document.querySelectorAll('.emergency-card').forEach(c => c.classList.remove('active'));
    };

    window.resolveFromDashboard = async function() {
        if (!selectedId) return;

        try {
            await fetch(`${API_BASE}/api/emergency/${selectedId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'resolved' })
            });

            // Force hash reset so the panel updates on next poll
            lastDetailHash = '';

            // Refresh immediately
            await pollEmergencies();
        } catch (err) {
            console.error('Failed to resolve:', err);
        }
    };

    window.filterEmergencies = function(filter, btn) {
        currentFilter = filter;

        // Update active tab
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');

        renderCards();
    };

    // ── Utilities ──
    function getTimeAgo(isoString) {
        const now = new Date();
        const then = new Date(isoString);
        const diffMs = now - then;
        const diffSec = Math.floor(diffMs / 1000);

        if (diffSec < 5) return 'just now';
        if (diffSec < 60) return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        const diffDay = Math.floor(diffHr / 24);
        return `${diffDay}d ago`;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Boot ──
    init();
})();
