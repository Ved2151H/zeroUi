/**
 * Zero UI | Emergency Console
 * ==========================
 * Realtime authority console on top of the backend feed:
 *
 *   REST snapshot  -> first paint (list + stats + server config)
 *   /ws/dashboard  -> emergency.created / .updated / .ended / event.added /
 *                     audio.segment / live_audio.state / stats
 *
 * Selection is by emergency_id everywhere; the detail pane and the audio
 * controller are hard-scoped to the selected emergency so audio can never mix.
 *
 * This file owns presentation only. Session handling (api.js), map drawing
 * (map.js) and audio (audio.js) are unchanged in contract.
 *
 * Motion is functional: it communicates state change (a card arriving, a tab
 * becoming active, a value updating, an incident activating) and never runs
 * for decoration. Every animation is disabled under prefers-reduced-motion.
 */

(() => {
    // ══════════════════════════════════════════════════════════════
    // State
    // ══════════════════════════════════════════════════════════════
    const state = {
        emergencies: new Map(),        // emergency_id -> summary
        selectedId: null,
        detail: null,                  // full detail of the selected emergency
        filter: 'all',
        query: '',
        staleAfter: 90,
        socket: null,
        serverConfig: {},
        realtime: {},
        soundEnabled: true,
        detailSignature: '',
        // Signature of the last rendered queue. Starts as null, not '', because
        // an empty result set hashes to '' and the two must stay distinct.
        listSignature: null,
        // emergency_id -> last rendered status, so a genuine status change can
        // be told apart from a plain refresh. Without this the queue would
        // either animate every row on every tick or never animate at all.
        cardStatus: new Map(),
        pane: 'overview',
        trackVisible: true,
        sortActiveFirst: true,
        refreshMs: 10000,
        liveSeconds: 0,
        timers: [],
        seenCards: new Set(),          // ids already rendered (drives enter motion)
    };

    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ══════════════════════════════════════════════════════════════
    // DOM
    // ══════════════════════════════════════════════════════════════
    const $ = (id) => document.getElementById(id);
    const dom = {
        appFrame: $('appFrame'), workspace: $('workspace'),
        navRail: $('navRail'), operatorBtn: $('operatorBtn'),
        operatorAvatar: $('operatorAvatar'), operatorName: $('operatorName'),
        avatarBtn: $('avatarBtn'), notifBtn: $('notifBtn'), notifBadge: $('notifBadge'),

        loginOverlay: $('loginOverlay'), loginForm: $('loginForm'), loginToken: $('loginToken'),
        loginOperator: $('loginOperator'), loginError: $('loginError'), loginSubmit: $('loginSubmit'),

        activeCount: $('activeCount'), activeCountValue: $('activeCountValue'),
        cancelledCount: $('cancelledCount'), cancelledCountValue: $('cancelledCountValue'),
        resolvedCount: $('resolvedCount'), resolvedCountValue: $('resolvedCountValue'),
        staleCount: $('staleCount'), staleCountValue: $('staleCountValue'),
        totalCount: $('totalCount'), totalCountValue: $('totalCountValue'),
        navCountAll: $('navCountAll'),

        linkDashboards: $('linkDashboards'), linkDevices: $('linkDevices'),
        linkAudio: $('linkAudio'),

        mapFocus: $('mapFocus'), mapFocusDot: $('mapFocusDot'),
        mapFocusDevice: $('mapFocusDevice'), mapFocusStatus: $('mapFocusStatus'),
        mapFocusCoords: $('mapFocusCoords'), mapFocusDigipin: $('mapFocusDigipin'),
        mapFocusTime: $('mapFocusTime'),

        statusDot: $('statusDot'), statusConnection: $('statusConnection'),
        statusOperator: $('statusOperator'), statusRefresh: $('statusRefresh'),
        statusIncidents: $('statusIncidents'),
        globalSearchWrap: $('globalSearchWrap'),

        connectionBadge: $('connectionBadge'), connectionText: $('connectionText'),
        alarmBanner: $('alarmBanner'), alarmText: $('alarmText'),
        alarmOpen: $('alarmOpen'), alarmDismiss: $('alarmDismiss'),

        listMeta: $('listMeta'), emergenciesList: $('emergenciesList'),
        listSearch: $('listSearch'), listSearchClear: $('listSearchClear'), listSearchWrap: $('listSearchWrap'),
        globalSearch: $('globalSearch'), globalSearchClear: $('globalSearchClear'),
        densityBtn: $('densityBtn'), sortBtn: $('sortBtn'),

        filterCountAll: $('filterCountAll'), filterCountActive: $('filterCountActive'),
        filterCountCancelled: $('filterCountCancelled'), filterCountResolved: $('filterCountResolved'),
        filterCountStale: $('filterCountStale'),

        mapContainer: $('mapContainer'), mapZoomIn: $('mapZoomIn'), mapZoomOut: $('mapZoomOut'),
        mapLocate: $('mapLocate'), mapLayers: $('mapLayers'),
        mapSearch: $('mapSearch'), mapSearchClear: $('mapSearchClear'), mapSearchWrap: $('mapSearchWrap'),
        mapOnlineCount: $('mapOnlineCount'), refreshSelect: $('refreshSelect'), mapLivePill: $('mapLivePill'),

        detailPanel: $('detailPanel'), detailBack: $('detailBack'), detailFullscreen: $('detailFullscreen'),
        detailIcon: $('detailIcon'), detailUser: $('detailUser'),
        detailEmergencyId: $('detailEmergencyId'), copyEmergencyId: $('copyEmergencyId'),
        detailStatusBadge: $('detailStatusBadge'), detailTriggerRow: $('detailTriggerRow'),
        detailTrigger: $('detailTrigger'), detailTime: $('detailTime'),
        detailConnState: $('detailConnState'), detailConnText: $('detailConnText'),
        detailTabs: $('detailTabs'), detailBody: $('detailBody'), tabInk: $('tabInk'),

        detailCoords: $('detailCoords'), detailDigipin: $('detailDigipin'),
        copyCoords: $('copyCoords'), copyDigipin: $('copyDigipin'),
        detailBattery: $('detailBattery'), detailBatteryBar: $('detailBatteryBar'),
        detailBatteryState: $('detailBatteryState'),
        detailNetwork: $('detailNetwork'), detailSignal: $('detailSignal'),
        detailLastUpdate: $('detailLastUpdate'),
        detailAudioCount: $('detailAudioCount'), detailAudioBar: $('detailAudioBar'),
        detailEventCount: $('detailEventCount'), detailEventBar: $('detailEventBar'),
        detailOverviewKv: $('detailOverviewKv'),

        liveAudioStage: $('liveAudioStage'), liveAudioState: $('liveAudioState'),
        liveWaveform: $('liveWaveform'), liveAudioTimer: $('liveAudioTimer'),
        liveAudioCaption: $('liveAudioCaption'), btnListenLive: $('btnListenLive'),
        btnStopLive: $('btnStopLive'), liveAudioHelp: $('liveAudioHelp'),
        segmentSummary: $('segmentSummary'), segmentList: $('segmentList'), audioPlayer: $('audioPlayer'),

        detailTimeline: $('detailTimeline'), tabCountEvents: $('tabCountEvents'),
        locationHistory: $('locationHistory'), locationCount: $('locationCount'),
        mediaSummary: $('mediaSummary'), mediaSegmentList: $('mediaSegmentList'), tabCountMedia: $('tabCountMedia'),
        detailDevice: $('detailDevice'), detailMapsLink: $('detailMapsLink'),
        detailTelemetry: $('detailTelemetry'), detailDetection: $('detailDetection'),

        noteRow: $('noteRow'), resolveNote: $('resolveNote'),
        btnDetailResolve: $('btnDetailResolve'), btnDetailCancel: $('btnDetailCancel'),
        btnAddNote: $('btnAddNote'),

        analyticsKpis: $('analyticsKpis'), analyticsStatusBars: $('analyticsStatusBars'),
        analyticsTriggerBars: $('analyticsTriggerBars'),
        reportsMeta: $('reportsMeta'), reportsTable: $('reportsTable'), reportsExport: $('reportsExport'),
        settingsSession: $('settingsSession'), settingsServer: $('settingsServer'),
        settingsRealtime: $('settingsRealtime'), soundToggle: $('soundToggle'),
        settingsRefresh: $('settingsRefresh'), settingsLogout: $('settingsLogout'),

        notifSound: $('notifSound'),
    };

    // ══════════════════════════════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════════════════════════════
    const NA = 'N/A';

    // India Post (the issuing authority for DIGIPIN) publishes a shareable
    // page per code, e.g. .../mydigipin/home/4C3FJ6M6T4. It is the only
    // official way to look a code up, and it accepts the bare code.
    const DIGIPIN_LOOKUP = 'https://dac.indiapost.gov.in/mydigipin/home/';

    const escapeHtml = (value) => {
        const div = document.createElement('div');
        div.textContent = value === null || value === undefined ? '' : String(value);
        return div.innerHTML;
    };

    const icon = (name, cls = 'icon') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

    function timeAgo(iso) {
        if (!iso) return NA;
        const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (seconds < 5) return 'just now';
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    }

    const clockTime = (iso) => (iso ? new Date(iso).toLocaleTimeString() : NA);

    /** A fixed-width clock for the log gutter: 24-hour, so the column is even. */
    const logTime = (iso) => {
        if (!iso) return NA;
        return new Date(iso).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
    };

    const fullTime = (iso) => {
        if (!iso) return NA;
        return new Date(iso).toLocaleString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const fmtDuration = (seconds) => {
        if (seconds === null || seconds === undefined) return NA;
        const total = Math.max(0, Math.round(seconds));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    };

    const fmtBytes = (bytes) => {
        if (!bytes) return '0 KB';
        return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
    };

    const TRIGGER_LABEL = {
        fall: 'Fall detected',
        manual: 'Manual SOS',
        shake: 'Shake SOS',
        test: 'Test trigger',
        // The handset's hardware button. Worded identically to the phone's own
        // `triggerLabel()` so the two applications describe one incident the
        // same way.
        hardware: 'Hardware button',
    };
    /**
     * The queue and dossier glyphs express status, not trigger type: an active
     * incident is the alarm, every closed incident is the person on the board.
     * The trigger is always spelled out in words beside the glyph, so nothing
     * is carried by the icon alone.
     */
    const STATUS_GLYPH = { emergency: 'alert', cancelled: 'user', resolved: 'user', stale: 'user' };
    const statusGlyph = (status) => STATUS_GLYPH[status] || 'user';

    const triggerLabel = (type) => TRIGGER_LABEL[type] || (type ? String(type) : 'Unknown');

    const STATUS_META = {
        emergency: { label: 'Active', icon: 'alert' },
        stale: { label: 'Stale', icon: 'clock' },
        cancelled: { label: 'Cancelled', icon: 'x' },
        resolved: { label: 'Resolved', icon: 'check' },
    };

    /** Connection state re-derived locally between server pushes. */
    function connectionState(emergency) {
        if (!emergency) return 'ended';
        if (emergency.status !== 'emergency' && emergency.status !== 'verifying') return 'ended';
        const last = new Date(emergency.last_update_at || emergency.created_at).getTime();
        return (Date.now() - last) / 1000 <= state.staleAfter ? 'live' : 'stale';
    }

    /** The single visual status a card or pill should express. */
    function displayStatus(emergency) {
        if (emergency.status === 'cancelled') return 'cancelled';
        if (emergency.status === 'resolved') return 'resolved';
        if (connectionState(emergency) === 'stale') return 'stale';
        return 'emergency';
    }

    /**
     * Retire an element with its exit animation, then hide it. Hidden elements
     * cannot animate, so the class has to be applied first and the element put
     * away once the motion has actually finished.
     */
    function dismiss(el, className = 'is-leaving') {
        if (!el || el.hidden) return;
        if (REDUCED) { el.hidden = true; return; }
        el.classList.add(className);
        const settle = () => {
            el.classList.remove(className);
            el.hidden = true;
        };
        el.addEventListener('animationend', settle, { once: true });
        // Belt and braces: if the animation never fires (element already off
        // screen, or motion collapsed), the message still goes away.
        setTimeout(() => { if (!el.hidden) settle(); }, 320);
    }

    function notice(message) {
        dom.alarmBanner.classList.remove('is-leaving');
        dom.alarmText.textContent = message;
        dom.alarmBanner.hidden = false;
    }

    /**
     * Write a value and, when it actually changed, run a short tick so the eye
     * is drawn to the one field that moved rather than the whole panel.
     */
    function setValue(el, text) {
        if (!el) return;
        if (el.textContent === text) return;
        el.textContent = text;
        tick(el);
    }

    function tick(el) {
        if (REDUCED) return;
        el.classList.remove('value-tick');
        void el.offsetWidth;              // restart the animation
        el.classList.add('value-tick');
    }

    // ══════════════════════════════════════════════════════════════
    // Navigation / views
    // ══════════════════════════════════════════════════════════════
    function setView(view) {
        document.querySelectorAll('.nav-item').forEach((item) => {
            const on = item.dataset.view === view;
            item.classList.toggle('active', on);
            if (on) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
        //
        // "Live Map" is a focus mode of the map surface, not a separate
        // document. There is exactly one Leaflet instance and it lives inside
        // the emergencies workspace, so that section has to stay mounted while
        // the map is focused. Activating a section that does not exist left
        // every view hidden, which collapsed the map container to 0x0 and
        // showed an operator nothing but the panel's black background.
        //
        const host = view === 'map' ? 'emergencies' : view;
        document.querySelectorAll('.view').forEach((section) => {
            section.classList.toggle('active', section.dataset.view === host);
        });

        // Collapse the deck to the map alone for that focus mode.
        dom.workspace.classList.toggle('map-only', view === 'map');

        if (view === 'analytics') renderAnalytics();
        if (view === 'reports') renderReports();
        if (view === 'settings') renderSettings();
        if (view === 'emergencies' || view === 'map') MapModule.invalidateSize();
    }

    document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => setView(item.dataset.view));
    });

    dom.operatorBtn.addEventListener('click', () => setView('settings'));
    dom.avatarBtn.addEventListener('click', () => setView('settings'));
    dom.detailFullscreen.addEventListener('click', () => setView('map'));

    // ══════════════════════════════════════════════════════════════
    // Session
    // ══════════════════════════════════════════════════════════════
    ApiClient.onUnauthorized(() => {
        stopRealtime();
        dom.loginOverlay.classList.add('visible');
        dom.loginError.textContent = 'Session expired. Sign in again.';
    });

    dom.loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        dom.loginError.textContent = '';
        dom.loginSubmit.disabled = true;
        dom.loginSubmit.textContent = 'Connecting';
        try {
            await ApiClient.login(dom.loginToken.value.trim(), dom.loginOperator.value.trim());
            dom.loginOverlay.classList.remove('visible');
            dom.loginToken.value = '';
            dom.operatorName.textContent = ApiClient.operator || 'Authority';
            dom.operatorAvatar.textContent = (ApiClient.operator || 'A').charAt(0).toUpperCase();
            dom.statusOperator.textContent = ApiClient.operator || 'authority';
            boot();
        } catch (error) {
            dom.loginError.textContent = error.message;
        } finally {
            dom.loginSubmit.disabled = false;
            dom.loginSubmit.innerHTML = `${icon('shield')} Connect to control room`;
        }
    });

    dom.settingsLogout.addEventListener('click', () => {
        stopRealtime();
        EmergencyAudio.stopAll();
        ApiClient.clearSession();
        location.reload();
    });

    // ══════════════════════════════════════════════════════════════
    // Realtime
    // ══════════════════════════════════════════════════════════════
    function setConnectionBadge(mode) {
        const label = { open: 'Live', reconnecting: 'Reconnecting', closed: 'Offline' }[mode] || mode;
        dom.connectionText.textContent = label;
        dom.connectionBadge.dataset.state = mode;
        if (dom.mapLivePill) dom.mapLivePill.style.opacity = mode === 'open' ? '1' : '0.55';
        setValue(dom.statusConnection, label);
        if (dom.statusDot) dom.statusDot.dataset.state = mode;
    }

    function stopRealtime() {
        if (state.socket) { state.socket.close(); state.socket = null; }
        setConnectionBadge('closed');
    }

    function startRealtime() {
        if (!ApiClient.token) { setConnectionBadge('closed'); return; }
        if (state.socket) state.socket.close();
        state.socket = ApiClient.connectSocket({
            onState: (mode) => setConnectionBadge(
                mode === 'open' ? 'open' : (mode === 'reconnecting' ? 'reconnecting' : 'closed')
            ),
            onMessage: handleRealtimeMessage,
        });
    }

    function handleRealtimeMessage(message) {
        switch (message.type) {
            case 'hello':
                state.serverConfig = message.server_config || {};
                state.staleAfter = state.serverConfig.stale_after_seconds || 90;
                state.realtime = message.realtime || {};
                state.emergencies.clear();
                (message.emergencies || []).forEach((em) => state.emergencies.set(em.emergency_id, em));
                renderAll();
                maybeRefreshSelectedDetail(true);
                if (state.selectedId) renderDetail();
                break;

            case 'emergency.created':
                state.emergencies.set(message.emergency.emergency_id, message.emergency);
                renderAll();
                announceEmergency(message.emergency);
                break;

            case 'emergency.updated':
                state.emergencies.set(message.emergency.emergency_id, message.emergency);
                renderAll();
                if (message.emergency.emergency_id === state.selectedId) {
                    mergeSummaryIntoDetail(message.emergency);
                    renderDetail();
                }
                break;

            case 'emergency.ended':
                state.emergencies.set(message.emergency.emergency_id, message.emergency);
                renderAll();
                if (message.emergency.emergency_id === state.selectedId) {
                    EmergencyAudio.stopLiveAudio();
                    updateLiveAudioUi('stopped');
                    mergeSummaryIntoDetail(message.emergency);
                    renderDetail();
                }
                break;

            case 'event.added':
                if (message.emergency_id === state.selectedId && state.detail && message.event) {
                    const events = state.detail.events || [];
                    if (!events.some((e) => e.id === message.event.id)) events.push(message.event);
                    state.detail.events = events;
                    renderTimeline();
                    renderOverviewStats();
                }
                break;

            case 'audio.segment':
                if (message.emergency_id === state.selectedId && state.detail && message.segment) {
                    const segments = state.detail.audio_segments || [];
                    if (!segments.some((s) => s.segment_id === message.segment.segment_id)) {
                        segments.push(message.segment);
                        segments.sort((a, b) => a.sequence - b.sequence);
                    }
                    state.detail.audio_segments = segments;
                    renderSegments();
                    renderOverviewStats();
                }
                break;

            case 'live_audio.state':
                if (message.emergency_id === state.selectedId) updateLiveAudioUi();
                break;

            case 'stats':
                state.realtime = message.realtime || {};
                renderSettings();
                renderLink();
                break;

            default:
                break;
        }
    }

    function announceEmergency(emergency) {
        playNotification();
        dom.alarmText.textContent = `${emergency.user_id}: ${triggerLabel(emergency.trigger_type)}`;
        dom.alarmBanner.hidden = false;
        dom.alarmBanner.dataset.emergencyId = emergency.emergency_id;
        bumpNotification();
        if (!state.selectedId) showDetail(emergency.emergency_id);
    }

    let unread = 0;
    function bumpNotification() {
        unread += 1;
        dom.notifBadge.hidden = false;
        dom.notifBadge.textContent = unread > 9 ? '9+' : String(unread);
    }
    dom.notifBtn.addEventListener('click', () => {
        unread = 0;
        dom.notifBadge.hidden = true;
        setView('emergencies');
    });

    function playNotification() {
        if (!state.soundEnabled || !dom.notifSound) return;
        try {
            dom.notifSound.currentTime = 0;
            dom.notifSound.play().catch(() => {});
        } catch (_) { /* ignore */ }
    }

    dom.alarmOpen.addEventListener('click', () => {
        const id = dom.alarmBanner.dataset.emergencyId;
        if (id) { setView('emergencies'); showDetail(id); }
    });
    dom.alarmDismiss.addEventListener('click', () => dismiss(dom.alarmBanner));

    // ══════════════════════════════════════════════════════════════
    // List derivation
    // ══════════════════════════════════════════════════════════════
    function all() {
        return Array.from(state.emergencies.values())
            .map((em) => ({ ...em, connection_state: connectionState(em) }));
    }

    function sorted() {
        const items = all();
        items.sort((a, b) => {
            if (state.sortActiveFirst) {
                const rank = (em) => (em.status === 'emergency' ? 0 : 1);
                if (rank(a) !== rank(b)) return rank(a) - rank(b);
            }
            return new Date(b.created_at) - new Date(a.created_at);
        });
        return items;
    }

    function matched(em) {
        if (!state.query) return true;
        const q = state.query.toLowerCase();
        return [
            em.user_id, em.emergency_id, em.digipin, em.status, em.connection_state,
            em.trigger_type, em.device && em.device.model,
            em.latitude, em.longitude,
        ].some((value) => String(value === null || value === undefined ? '' : value).toLowerCase().includes(q));
    }

    function filtered() {
        const items = sorted().filter(matched);
        switch (state.filter) {
            case 'emergency': return items.filter((em) => em.status === 'emergency' && em.connection_state !== 'stale');
            case 'stale': return items.filter((em) => em.connection_state === 'stale' && em.status === 'emergency');
            case 'cancelled': return items.filter((em) => em.status === 'cancelled');
            case 'resolved': return items.filter((em) => em.status === 'resolved');
            default: return items;
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Counts
    // ══════════════════════════════════════════════════════════════
    function renderCounts() {
        const items = all();
        const active = items.filter((em) => em.status === 'emergency' && em.connection_state !== 'stale').length;
        const stale = items.filter((em) => em.connection_state === 'stale' && em.status === 'emergency').length;
        const cancelled = items.filter((em) => em.status === 'cancelled').length;
        const resolved = items.filter((em) => em.status === 'resolved').length;

        const set = (a, b, value) => { setValue(a, String(value)); setValue(b, String(value)); };
        set(dom.activeCount, dom.activeCountValue, active);
        set(dom.cancelledCount, dom.cancelledCountValue, cancelled);
        set(dom.resolvedCount, dom.resolvedCountValue, resolved);
        set(dom.staleCount, dom.staleCountValue, stale);

        setValue(dom.filterCountAll, String(items.length));
        setValue(dom.filterCountActive, String(active));
        setValue(dom.filterCountCancelled, String(cancelled));
        setValue(dom.filterCountResolved, String(resolved));
        setValue(dom.filterCountStale, String(stale));
        setValue(dom.navCountAll, String(items.length));
        setValue(dom.mapOnlineCount, String(active));
        setValue(dom.totalCount, String(items.length));
        setValue(dom.totalCountValue, String(items.length));
        setValue(dom.statusIncidents, String(items.length));
        renderLink();
    }

    /** Realtime socket counters, mirrored into the situation band. */
    function renderLink() {
        const rt = state.realtime || {};
        setValue(dom.linkDashboards, String(rt.dashboard_sockets || 0));
        setValue(dom.linkDevices, String(rt.device_sockets || 0));
        setValue(dom.linkAudio, String(rt.live_audio_emergencies || 0));
    }

    // ══════════════════════════════════════════════════════════════
    // List rendering
    // ══════════════════════════════════════════════════════════════
    function renderList() {
        const items = filtered();
        dom.listMeta.textContent = items.length === 0
            ? 'No incidents match this filter'
            : `${items.length} incident${items.length === 1 ? '' : 's'} of ${all().length} total`;

        // Rebuild only when the set or order actually changes; a full rebuild on
        // every relative-time tick would make the list flicker.
        //
        // The signature is held in state rather than on the element. It used to
        // live in `dataset.signature` and be cleared to '' to force a rebuild,
        // but an empty result set also hashes to '', so "No incidents match
        // this filter" returned early and left the previous cards on screen:
        // the filter chip lit up and the metadata updated while the queue
        // still showed every incident.
        const signature = items.map((em) => `${em.emergency_id}:${displayStatus(em)}`).join('|');
        if (state.listSignature === signature) return;
        state.listSignature = signature;

        dom.emergenciesList.innerHTML = '';
        if (items.length === 0) {
            dom.emergenciesList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">${icon('shield')}</div>
                    <p class="empty-title">No emergencies to show</p>
                    <p class="empty-sub">Listening for device activations on the realtime feed.</p>
                </div>`;
            return;
        }
        items.forEach((em, index) => {
            const card = createCard(em);
            const status = displayStatus(em);
            const previous = state.cardStatus.get(em.emergency_id);

            // Arriving incidents settle in; already-known cards just render.
            if (!REDUCED && !state.seenCards.has(em.emergency_id)) {
                state.seenCards.add(em.emergency_id);
                card.classList.add('card-enter');
                card.style.animationDelay = `${Math.min(index * 24, 160)}ms`;
            } else if (!REDUCED && previous && previous !== status) {
                // Active became resolved, or the reverse. Only this row moves.
                card.classList.add('status-changed');
            }

            state.cardStatus.set(em.emergency_id, status);
            dom.emergenciesList.appendChild(card);
        });

        // Forget incidents that have left the feed, so a returning id is
        // treated as new rather than as a status change.
        const present = new Set(items.map((em) => em.emergency_id));
        state.cardStatus.forEach((_, id) => {
            if (!present.has(id)) state.cardStatus.delete(id);
        });
    }

    function coords(em) {
        if (em.latitude === null || em.latitude === undefined) return NA;
        return `${Number(em.latitude).toFixed(4)}, ${Number(em.longitude).toFixed(4)}`;
    }

    function createCard(em) {
        const card = document.createElement('button');
        card.type = 'button';
        const status = displayStatus(em);
        card.className = `emergency-card status-${status}` +
            (em.emergency_id === state.selectedId ? ' selected' : '');
        card.dataset.emergencyId = em.emergency_id;
        card.addEventListener('click', () => showDetail(em.emergency_id));

        const meta = STATUS_META[status] || STATUS_META.emergency;
        const segments = em.audio_segment_count || 0;
        const liveAudio = em.live_audio && em.live_audio.device_streaming;

        card.innerHTML = `
            <span class="qrow-glyph status-${status}">
                ${icon(statusGlyph(status), 'icon icon-sm')}
            </span>
            <span class="qrow-body">
                <span class="qrow-line1">
                    <span class="qrow-device">${escapeHtml(em.user_id)}</span>
                    <span class="card-status ${status}"><span class="pill-dot"></span>${meta.label}</span>
                </span>
                <span class="qrow-line2">
                    <span class="qrow-trigger">${escapeHtml(triggerLabel(em.trigger_type))}</span>
                    <span class="qrow-time card-time">${timeAgo(em.last_update_at || em.created_at)}</span>
                </span>
                <span class="qrow-line3">
                    <span class="qrow-coord">${coords(em)}</span>
                    <span class="qrow-sep"></span>
                    ${em.digipin
                        ? `<span class="digipin-chip">${escapeHtml(em.digipin)}</span>`
                        : `<span class="digipin-chip muted">No DIGIPIN</span>`}
                    ${segments
                        ? `<span class="qrow-sep"></span><span class="qrow-audio">${icon('audio', 'icon icon-xs')} ${segments}</span>`
                        : ''}
                </span>
                ${liveAudio ? `<span class="card-live-row"><span class="live-dot"></span> Live audio streaming</span>` : ''}
                ${status === 'stale' ? `<span class="card-stale-row">${icon('clock', 'icon icon-xs')} No update for ${Math.round(em.age_seconds || 0)}s</span>` : ''}
            </span>
        `;
        return card;
    }

    // ══════════════════════════════════════════════════════════════
    // Selection
    // ══════════════════════════════════════════════════════════════
    async function showDetail(emergencyId) {
        const switching = state.selectedId !== emergencyId;

        EmergencyAudio.setSelectedEmergency(emergencyId);
        updateLiveAudioUi('stopped');
        dom.resolveNote.value = '';
        dom.noteRow.classList.remove('visible');

        state.selectedId = emergencyId;
        lastEventCount = 0;            // the newest event animates in once
        MapModule.setSelected(emergencyId);
        dom.detailPanel.classList.remove('is-empty');
        if (switching && !REDUCED) {
            dom.detailPanel.classList.remove('panel-enter');
            void dom.detailPanel.offsetWidth;
            dom.detailPanel.classList.add('panel-enter');
            if (dom.mapFocus) {
                dom.mapFocus.classList.remove('map-focus-enter');
                void dom.mapFocus.offsetWidth;
                dom.mapFocus.classList.add('map-focus-enter');
            }
        }
        renderList();

        try {
            state.detail = await ApiClient.detail(emergencyId);
            state.detailSignature = '';
            renderDetail(true);
            MapModule.updateMarkers(all());
            if (state.detail.latitude !== null) {
                MapModule.focusOn(state.detail.latitude, state.detail.longitude, 16);
            }
            MapModule.drawTrack(state.detail.locations, state.detail.status);
            await refreshLiveAudioState();
        } catch (error) {
            console.error('Failed to load emergency detail', error);
        }
    }

    function mergeSummaryIntoDetail(summary) {
        if (!state.detail) return;
        state.detail = { ...state.detail, ...summary };
    }

    async function maybeRefreshSelectedDetail(force) {
        if (!state.selectedId) return;
        try {
            const detail = await ApiClient.detail(state.selectedId);
            state.detail = detail;
            renderDetail(force);
            MapModule.drawTrack(detail.locations, detail.status);
        } catch (error) {
            console.warn('Detail refresh failed', error);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Detail rendering
    // ══════════════════════════════════════════════════════════════
    const PLACEHOLDER = (text) => `<span class="telemetry-empty">${text}</span>`;

    function renderEmptyDetail() {
        dom.detailIcon.className = 'dossier-glyph';
        dom.detailIcon.innerHTML = icon('shield');
        dom.detailUser.textContent = 'No incident selected';
        dom.detailEmergencyId.textContent = NA;
        dom.detailStatusBadge.className = 'status-pill';
        dom.detailStatusBadge.innerHTML = '';
        dom.detailTrigger.textContent = 'Select an incident from the list';
        dom.detailTime.textContent = NA;
        dom.detailConnState.className = 'conn-pill ended';
        dom.detailConnText.textContent = 'IDLE';

        dom.detailCoords.textContent = NA;
        dom.detailDigipin.textContent = NA;
        dom.detailDigipin.removeAttribute('href');
        dom.detailBattery.innerHTML = NA;
        dom.detailBatteryBar.style.width = '0%';
        dom.detailNetwork.textContent = NA;
        Array.from(dom.detailSignal.children).forEach((bar) => bar.classList.remove('on'));
        dom.detailLastUpdate.textContent = NA;
        dom.detailAudioCount.textContent = '0';
        dom.detailEventCount.textContent = '0';
        dom.detailAudioBar.style.width = '0%';
        dom.detailEventBar.style.width = '0%';
        dom.detailOverviewKv.innerHTML = PLACEHOLDER('No incident selected');
        dom.detailTelemetry.innerHTML = PLACEHOLDER('No telemetry received yet');
        dom.detailDetection.innerHTML = PLACEHOLDER('No detection evidence recorded');
        dom.detailTimeline.innerHTML = PLACEHOLDER('No events yet');
        dom.locationHistory.innerHTML = PLACEHOLDER('No location samples yet');
        dom.segmentList.innerHTML = PLACEHOLDER('No segments uploaded yet');
        dom.mediaSegmentList.innerHTML = PLACEHOLDER('No segments uploaded yet');
        dom.locationCount.textContent = '';
        dom.segmentSummary.textContent = '';
        dom.mediaSummary.textContent = '';
        dom.tabCountEvents.textContent = '';
        dom.tabCountMedia.textContent = '';
        dom.detailDevice.textContent = NA;
        dom.detailMapsLink.removeAttribute('href');

        if (dom.mapFocus) dom.mapFocus.hidden = true;

        dom.detailPanel.classList.add('is-empty');
        [dom.btnDetailResolve, dom.btnDetailCancel, dom.btnAddNote].forEach((b) => { b.disabled = true; });
    }

    function updateDetailHeader(detail) {
        const status = displayStatus(detail);
        const meta = STATUS_META[status] || STATUS_META.emergency;

        dom.detailIcon.className = `dossier-glyph ${status}`;
        dom.detailIcon.innerHTML = icon(statusGlyph(status));
        setValue(dom.detailUser, detail.user_id);
        setValue(dom.detailEmergencyId, detail.emergency_id);

        const pillHtml = `<span class="pill-dot"></span>${meta.label}`;
        if (dom.detailStatusBadge.innerHTML !== pillHtml) {
            dom.detailStatusBadge.className = `status-pill ${status}`;
            dom.detailStatusBadge.innerHTML = pillHtml;
            dom.detailStatusBadge.classList.remove('value-tick');
            void dom.detailStatusBadge.offsetWidth;
            dom.detailStatusBadge.classList.add('value-tick');
        }

        setValue(dom.detailTrigger, triggerLabel(detail.trigger_type));
        setValue(dom.detailTime, `${fullTime(detail.created_at)} (${timeAgo(detail.created_at)})`);

        const conn = connectionState(detail);
        dom.detailConnState.className = `conn-pill ${conn}`;
        setValue(dom.detailConnText, conn === 'live' ? 'LIVE' : conn === 'stale' ? 'STALE' : 'ENDED');

        const lat = detail.latitude;
        const lng = detail.longitude;
        setValue(dom.detailCoords, lat !== null && lng !== null
            ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}` : NA);

        setValue(dom.detailDigipin, detail.digipin || 'Unavailable');
        dom.detailDigipin.style.color = detail.digipin ? '' : 'var(--text-3)';
        // India Post publishes a page per DIGIPIN. With a code in hand the
        // value becomes a link to it, so the grade of the address can be
        // confirmed against the source of record rather than trusted blind.
        if (detail.digipin) {
            dom.detailDigipin.href = `${DIGIPIN_LOOKUP}${encodeURIComponent(detail.digipin)}`;
        } else {
            dom.detailDigipin.removeAttribute('href');
        }

        setValue(dom.detailLastUpdate, timeAgo(detail.last_update_at));
        dom.detailMapsLink.href = `https://www.google.com/maps?q=${lat},${lng}`;

        const device = detail.device || {};
        setValue(dom.detailDevice, device.device_id
            ? `${device.manufacturer || 'Device'} ${device.model || ''}`.trim()
            : 'unknown device');

        renderOverviewStats();
        renderOverviewKv();
        renderMapFocus(detail);
    }

    /**
     * Mirror the selected incident onto the map surface, so an operator
     * reading the map alone can see which incident is under response. Every
     * value here comes from the incident detail; nothing is derived.
     */
    function renderMapFocus(detail) {
        if (!dom.mapFocus || !detail) return;
        const status = displayStatus(detail);
        dom.mapFocus.hidden = false;
        dom.mapFocus.className = `map-focus status-${status}`;
        dom.mapFocusDot.className = `status-dot ${status}`;
        setValue(dom.mapFocusDevice, detail.user_id || NA);
        setValue(dom.mapFocusStatus, (STATUS_META[status] || STATUS_META.emergency).label);

        const lat = detail.latitude;
        const lng = detail.longitude;
        setValue(dom.mapFocusCoords, lat !== null && lat !== undefined && lng !== null && lng !== undefined
            ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : NA);
        setValue(dom.mapFocusDigipin, detail.digipin || 'Unavailable');
        setValue(dom.mapFocusTime, timeAgo(detail.last_update_at || detail.created_at));
    }

    function renderOverviewStats() {
        const detail = state.detail || {};
        const telemetry = detail.telemetry || {};

        // Battery. The charge state used to ride in the value ("92% (charging)"),
        // which does not fit the half-width tile: measured at 70px of room the
        // string needed 94px and was clipped to "92% (charg". It now sits as a
        // tag beside the label, where the whole word has room to be read.
        const battery = telemetry.battery_pct;
        const hasBattery = battery !== undefined && battery !== null;
        const batteryText = hasBattery ? `${Math.round(battery)}%` : NA;
        if (dom.detailBattery.textContent !== batteryText) {
            dom.detailBattery.textContent = batteryText;
            tick(dom.detailBattery);
        }
        if (dom.detailBatteryState) {
            dom.detailBatteryState.hidden = !telemetry.charging;
        }
        const pct = battery === undefined || battery === null ? 0 : Math.max(0, Math.min(100, battery));
        dom.detailBatteryBar.style.width = `${pct}%`;
        dom.detailBatteryBar.style.background = pct <= 20 ? 'var(--danger)' : 'var(--success)';

        // Network
        const network = telemetry.network_type || telemetry.connectivity || NA;
        setValue(dom.detailNetwork, network);
        const strength = { '5G': 4, '4G': 4, 'LTE': 4, '3G': 3, '2G': 2, 'wifi': 4, 'Wi-Fi': 4 }[network]
            || (network === NA ? 0 : 3);
        Array.from(dom.detailSignal.children).forEach((bar, index) => {
            bar.classList.toggle('on', index < strength);
        });

        // Audio + events
        const segments = (detail.audio_segments || []).length;
        const events = (detail.events || []).length;
        setValue(dom.detailAudioCount, String(segments));
        setValue(dom.detailEventCount, String(events));
        dom.detailAudioBar.style.width = `${Math.min(100, segments * 10)}%`;
        dom.detailEventBar.style.width = `${Math.min(100, events * 6)}%`;

        setValue(dom.tabCountEvents, events ? String(events) : '');
        setValue(dom.tabCountMedia, segments ? String(segments) : '');
    }

    function kvRow(key, value, cls = '') {
        if (value === null || value === undefined || value === '') return '';
        return `<div class="kv-row"><span class="kv-key">${escapeHtml(key)}</span>
            <span class="kv-val ${cls}">${escapeHtml(value)}</span></div>`;
    }

    function renderOverviewKv() {
        const detail = state.detail || {};
        const telemetry = detail.telemetry || {};
        dom.detailOverviewKv.innerHTML = [
            kvRow('Emergency ID', detail.emergency_id),
            kvRow('Device', (detail.device && detail.device.device_id) || NA),
            kvRow('Trigger', triggerLabel(detail.trigger_type)),
            kvRow('GPS accuracy', detail.location_accuracy_m !== null && detail.location_accuracy_m !== undefined
                ? `+/-${Math.round(detail.location_accuracy_m)} m` : NA),
            kvRow('Location provider', detail.location_provider),
            kvRow('Duration', fmtDuration(detail.duration_seconds)),
            kvRow('Foreground service', telemetry.foreground_service === undefined ? null
                : (telemetry.foreground_service ? 'running' : 'stopped'),
                telemetry.foreground_service ? 'ok' : 'warn'),
            kvRow('App state', telemetry.app_state),
            kvRow('Motion', telemetry.motion_state),
            kvRow('DIGIPIN source', detail.digipin_available === false ? 'outside coverage' : 'India Post'),
            kvRow('Ended by', detail.ended_by),
            kvRow('Resolution note', detail.resolution_note),
        ].filter(Boolean).join('') || PLACEHOLDER('No session data yet');
    }

    function renderTelemetry() {
        const detail = state.detail || {};
        const telemetry = detail.telemetry || {};
        const capabilities = telemetry.capabilities || (detail.device && detail.device.capabilities) || {};

        const rows = [
            kvRow('Battery', telemetry.battery_pct !== undefined && telemetry.battery_pct !== null
                ? `${Math.round(telemetry.battery_pct)}%${telemetry.charging ? ' (charging)' : ''}` : null),
            kvRow('Network', telemetry.network_type || telemetry.connectivity),
            kvRow('App state', telemetry.app_state),
            kvRow('Foreground service', telemetry.foreground_service === undefined ? null
                : (telemetry.foreground_service ? 'running' : 'stopped')),
            kvRow('Screen', telemetry.screen_on === undefined ? null : (telemetry.screen_on ? 'on' : 'off')),
            kvRow('Audio session', telemetry.audio_session_active === undefined ? null
                : (telemetry.audio_session_active ? 'capturing' : 'idle')),
            kvRow('Audio segment number', telemetry.audio_segment_sequence),
            kvRow('GPS enabled', telemetry.gps_enabled === undefined ? null : (telemetry.gps_enabled ? 'yes' : 'no')),
            kvRow('Microphone', telemetry.mic_available === undefined ? null
                : (telemetry.mic_available ? 'available' : 'unavailable')),
            kvRow('Accelerometer', telemetry.accelerometer_magnitude !== undefined && telemetry.accelerometer_magnitude !== null
                ? `${Number(telemetry.accelerometer_magnitude).toFixed(2)} m/s2` : null),
            kvRow('Motion', telemetry.motion_state),
        ].filter(Boolean);

        const sensorList = Object.entries(telemetry.sensors || {})
            .map(([name, ok]) => `${name} ${ok ? 'present' : 'absent'}`).join(', ');
        const capabilityList = Object.entries(capabilities)
            .map(([name, ok]) => `${name} ${ok ? 'present' : 'absent'}`).join(', ');

        if (sensorList) rows.push(kvRow('Sensors', sensorList));
        if (capabilityList) rows.push(kvRow('Capabilities', capabilityList));

        dom.detailTelemetry.innerHTML = rows.join('') || PLACEHOLDER('No telemetry received yet');

        const detection = detail.trigger_metadata || {};
        dom.detailDetection.innerHTML = [
            kvRow('Impact', detection.impact_magnitude !== undefined
                ? `${Number(detection.impact_magnitude).toFixed(1)} m/s2` : null),
            kvRow('Free fall', detection.freefall_ms !== undefined ? `${detection.freefall_ms} ms` : null),
            kvRow('Inactivity', detection.inactivity_ms !== undefined ? `${detection.inactivity_ms} ms` : null),
            kvRow('Stillness deviation', detection.inactivity_std_dev !== undefined
                ? Number(detection.inactivity_std_dev).toFixed(2) : null),
            kvRow('Countdown', detection.countdown_seconds !== undefined && detection.countdown_seconds !== null
                ? `${detection.countdown_seconds}s expired` : null),
        ].filter(Boolean).join('') || PLACEHOLDER('No detection evidence recorded');
    }

    function renderLocations() {
        const detail = state.detail || {};
        const locations = (detail.locations || []).slice().reverse();
        setValue(dom.locationCount, locations.length ? `${locations.length} samples` : '');
        if (locations.length === 0) {
            dom.locationHistory.innerHTML = PLACEHOLDER('No location samples yet');
            return;
        }
        dom.locationHistory.innerHTML = locations.slice(0, 60).map((loc) => `
            <div class="tl-entry">
                <span class="tl-marker"><span class="tl-dot safe"></span></span>
                <span class="tl-time">
                    <span class="tl-clock">${logTime(loc.timestamp)}</span>
                    <span class="tl-ago">${timeAgo(loc.timestamp)}</span>
                </span>
                <span class="tl-content">
                    <span class="tl-type">${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}
                        <span class="tl-source">${escapeHtml(loc.provider || 'gps')}</span></span>
                    <span class="tl-desc">DigiPIN <strong>${escapeHtml(loc.digipin || 'unavailable')}</strong>
                        ${loc.accuracy_m ? `, +/-${Math.round(loc.accuracy_m)} m` : ''}
                        ${loc.is_mock ? ', <span class="mock-flag">mock location</span>' : ''}</span>
                </span>
            </div>`).join('');
    }

    /** Event count at the previous paint, so only genuinely new entries animate. */
    let lastEventCount = 0;

    function renderTimeline() {
        const detail = state.detail || {};
        const events = detail.events || [];
        setValue(dom.tabCountEvents, events.length ? String(events.length) : '');
        if (events.length === 0) {
            dom.detailTimeline.innerHTML = PLACEHOLDER('No events yet');
            lastEventCount = 0;
            return;
        }

        // Newest first. Only an entry that genuinely arrived since the last
        // paint gets the entry transition, so the log never animates in bulk.
        const grew = events.length > lastEventCount;
        dom.detailTimeline.innerHTML = events.slice().reverse().map((event, index) => {
            const type = event.event_type || '';
            let dot = 'info';
            if (/emergency|sos|fall|no_response|cancel/.test(type)) dot = 'emergency';
            else if (/audio|mic|countdown|verif|location|gps|digipin/.test(type)) dot = 'verifying';
            else if (/resolved|safe|sms/.test(type)) dot = 'safe';
            const fresh = grew && index === 0 ? ' is-new' : '';
            return `
                <div class="tl-entry${fresh}">
                    <span class="tl-marker"><span class="tl-dot ${dot}"></span></span>
                    <span class="tl-time">
                        <span class="tl-clock">${logTime(event.timestamp)}</span>
                        <span class="tl-ago">${timeAgo(event.timestamp)}</span>
                    </span>
                    <span class="tl-content">
                        <span class="tl-type">${escapeHtml(type.replace(/_/g, ' '))}
                            ${event.source ? `<span class="tl-source">${escapeHtml(event.source)}</span>` : ''}</span>
                        <span class="tl-desc">${escapeHtml(event.description)}</span>
                    </span>
                </div>`;
        }).join('');
        lastEventCount = events.length;
    }

    function segmentMarkup(segment, emergencyId) {
        return `
            <div class="segment-item" data-segment-id="${escapeHtml(segment.segment_id)}">
                <button class="segment-play-icon" data-play="${escapeHtml(segment.segment_id)}" aria-label="Play segment">
                    ${icon('play')}
                </button>
                <span class="segment-info">
                    <span class="segment-seq">Segment ${segment.sequence}</span>
                    <span class="segment-meta">${segment.duration_seconds ? `${Math.round(segment.duration_seconds)}s, ` : ''}${fmtBytes(segment.size_bytes)}, ${clockTime(segment.started_at || segment.created_at)}</span>
                </span>
                <a class="segment-dl" href="${ApiClient.segmentUrl(emergencyId, segment.segment_id)}"
                   download="${escapeHtml(segment.file_name || 'segment')}" aria-label="Download segment">
                    ${icon('download', 'icon')}
                </a>
            </div>`;
    }

    function renderSegments() {
        const detail = state.detail || {};
        const segments = detail.audio_segments || [];
        const total = detail.audio_total_bytes || segments.reduce((a, s) => a + (s.size_bytes || 0), 0);
        const summary = segments.length ? `${segments.length}, ${fmtBytes(total)}` : '';
        setValue(dom.segmentSummary, summary);
        setValue(dom.mediaSummary, summary);
        setValue(dom.tabCountMedia, segments.length ? String(segments.length) : '');

        const empty = PLACEHOLDER('No segments uploaded yet');
        const html = segments.length
            ? segments.map((s) => segmentMarkup(s, detail.emergency_id)).join('')
            : empty;
        dom.segmentList.innerHTML = html;
        dom.mediaSegmentList.innerHTML = html;

        document.querySelectorAll('[data-play]').forEach((button) => {
            button.addEventListener('click', () => {
                if (!state.detail) return;
                EmergencyAudio.playSegment(state.detail.emergency_id, button.dataset.play);
                updateLiveAudioUi('segment');
            });
        });
    }

    function renderDetail(force) {
        const detail = state.detail;
        if (!detail) return;

        const signature = JSON.stringify([
            detail.emergency_id, detail.status, detail.last_update_at, detail.latitude, detail.longitude,
            (detail.events || []).length, (detail.locations || []).length,
            (detail.audio_segments || []).length, JSON.stringify(detail.telemetry || {}),
        ]);
        const changed = signature !== state.detailSignature;

        dom.detailPanel.classList.remove('is-empty');
        updateDetailHeader(detail);

        if (force || changed) {
            renderTelemetry();
            renderLocations();
            renderTimeline();
            renderSegments();
        }
        state.detailSignature = signature;

        const active = detail.status === 'emergency' || detail.status === 'verifying';
        [dom.btnDetailResolve, dom.btnDetailCancel, dom.btnAddNote].forEach((button) => {
            button.disabled = !active;
        });
    }

    // ── Tabs with a sliding indicator ──
    function moveTabInk() {
        const activeTab = dom.detailTabs.querySelector('.tab.active');
        if (!activeTab || !dom.tabInk) return;
        dom.tabInk.style.transform = `translateX(${activeTab.offsetLeft}px)`;
        dom.tabInk.style.width = `${activeTab.offsetWidth}px`;
    }

    function selectPane(pane) {
        state.pane = pane;
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.pane === pane));
        document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === pane));
        moveTabInk();
        if (pane === 'audio') renderWaveform();
    }

    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => selectPane(tab.dataset.pane));
    });

    // ══════════════════════════════════════════════════════════════
    // Live audio + waveform
    // ══════════════════════════════════════════════════════════════
    const WAVE_BARS = 56;
    const waveHistory = new Array(WAVE_BARS).fill(0);
    let waveTimer = null;

    function renderWaveform() {
        if (!dom.liveWaveform) return;
        if (dom.liveWaveform.childElementCount !== WAVE_BARS) {
            dom.liveWaveform.innerHTML = new Array(WAVE_BARS).fill('<i></i>').join('');
        }
    }

    function paintWave() {
        Array.from(dom.liveWaveform.children).forEach((bar, index) => {
            const value = waveHistory[index];
            bar.style.height = `${3 + Math.round(Math.sqrt(value) * 44)}px`;
        });
    }

    function pushWaveLevel(level) {
        waveHistory.push(Math.max(0, Math.min(1, level)));
        waveHistory.shift();
        renderWaveform();
        paintWave();
    }

    /** Idle is a flat baseline. No invented activity when nothing is streaming. */
    function idleWaveform() {
        renderWaveform();
        waveHistory.fill(0);
        paintWave();
    }

    EmergencyAudio.onState((liveState, info) => updateLiveAudioUi(liveState, info));
    EmergencyAudio.onLevel((level) => pushWaveLevel(level));

    async function refreshLiveAudioState() {
        if (!state.selectedId) return;
        try {
            const info = await ApiClient.liveAudioState(state.selectedId);
            updateLiveAudioUi(info.device_streaming ? 'streaming' : 'idle', info);
        } catch (_) { /* ignore */ }
    }

    function updateLiveAudioUi(liveState, info) {
        const detail = state.detail;
        const streaming = detail && detail.live_audio ? detail.live_audio.device_streaming : false;
        const value = liveState || EmergencyAudio.stats().state;

        const labels = {
            idle: streaming ? 'Device is streaming' : 'Not streaming',
            waiting: 'Connected, awaiting frames',
            streaming: 'Live',
            connecting: 'Connecting',
            stopped: streaming ? 'Stopped locally' : 'Not streaming',
            error: 'Live audio error',
            segment: 'Playing stored segment',
        };
        const captions = {
            idle: 'Live audio begins when the phone reports it is streaming.',
            waiting: 'Listening to device audio.',
            streaming: 'Listening to device audio.',
            connecting: 'Opening the live channel.',
            stopped: 'Live audio stopped.',
            error: 'The live audio channel could not be opened.',
            segment: 'Playing a recorded segment from this device.',
        };

        setValue(dom.liveAudioState, labels[value] || value);
        dom.liveAudioState.className = `live-audio-state ${value}`;
        setValue(dom.liveAudioCaption, captions[value] || captions.idle);
        dom.liveAudioStage.classList.toggle('streaming', value === 'streaming');
        dom.btnStopLive.disabled = !['streaming', 'waiting', 'connecting'].includes(value);

        if (info && info.format) {
            dom.liveAudioHelp.textContent =
                `Format ${info.format.encoding} at ${info.format.sample_rate} Hz. ${info.listeners || 0} listener(s) on this incident.`;
        }

        const live = ['streaming', 'waiting', 'connecting'].includes(value);
        if (live && !waveTimer) {
            state.liveSeconds = 0;
            waveTimer = setInterval(() => {
                state.liveSeconds += 1;
                const mins = String(Math.floor(state.liveSeconds / 60)).padStart(2, '0');
                const secs = String(state.liveSeconds % 60).padStart(2, '0');
                setValue(dom.liveAudioTimer, `${mins}:${secs}`);
                // Only decay between real frames; never fabricate signal.
                if (EmergencyAudio.stats().state !== 'streaming') {
                    waveHistory.push(0);
                    waveHistory.shift();
                    paintWave();
                }
            }, 1000);
        } else if (!live && waveTimer) {
            clearInterval(waveTimer);
            waveTimer = null;
            state.liveSeconds = 0;
            setValue(dom.liveAudioTimer, '00:00');
            idleWaveform();
        }
    }

    dom.btnListenLive.addEventListener('click', async () => {
        if (!state.selectedId) return;
        EmergencyAudio.setSelectedEmergency(state.selectedId);
        const ok = EmergencyAudio.startLive(state.selectedId);
        if (ok) updateLiveAudioUi('connecting');
        try { await ApiClient.requestDeviceLiveAudio(state.selectedId, true); } catch (_) { /* best effort */ }
    });
    dom.btnStopLive.addEventListener('click', () => {
        EmergencyAudio.stopLiveAudio();
        updateLiveAudioUi('stopped');
    });

    // ══════════════════════════════════════════════════════════════
    // Actions
    // ══════════════════════════════════════════════════════════════
    dom.btnAddNote.addEventListener('click', () => {
        dom.noteRow.classList.toggle('visible');
        if (dom.noteRow.classList.contains('visible')) dom.resolveNote.focus();
    });

    async function endEmergency(prefix) {
        if (!state.selectedId) return;
        const emergencyId = state.selectedId;
        const note = dom.resolveNote.value.trim();
        const finalNote = prefix ? `${prefix}${note ? `: ${note}` : ''}` : (note || null);

        [dom.btnDetailResolve, dom.btnDetailCancel].forEach((b) => { b.disabled = true; });
        try {
            await ApiClient.resolve(emergencyId, finalNote);
            EmergencyAudio.stopAll();
            await maybeRefreshSelectedDetail(true);
            renderList();
            renderCounts();
        } catch (error) {
            notice(`Could not close the incident: ${error.message}`);
        } finally {
            [dom.btnDetailResolve, dom.btnDetailCancel].forEach((b) => { b.disabled = false; });
        }
    }

    dom.btnDetailResolve.addEventListener('click', () => endEmergency(null));

    /**
     * The authority API exposes `resolve` only. "Mark Cancelled" therefore closes
     * the incident through the same endpoint and records the operator's intent in
     * the resolution note, so the audit trail stays truthful.
     */
    dom.btnDetailCancel.addEventListener('click', () => endEmergency('Cancelled from the authority console'));

    // ══════════════════════════════════════════════════════════════
    // Copy buttons
    // ══════════════════════════════════════════════════════════════
    /**
     * Copy, with a fallback.
     *
     * The async clipboard API needs a focused document and a secure context,
     * and its refusal used to be swallowed whole: the button produced no icon
     * change and no message, so it read as a dead control. The textarea route
     * still works when the async API refuses, and the rare double refusal is
     * reported on the button instead of passing silently.
     */
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) { /* fall through to the selection route */ }
        try {
            const scratch = document.createElement('textarea');
            scratch.value = text;
            scratch.setAttribute('readonly', '');
            scratch.style.position = 'fixed';
            scratch.style.top = '-1000px';
            scratch.style.opacity = '0';
            document.body.appendChild(scratch);
            scratch.select();
            scratch.setSelectionRange(0, text.length);
            const ok = document.execCommand('copy');
            scratch.remove();
            return ok;
        } catch (_) {
            return false;
        }
    }

    function wireCopy(button, getValue) {
        button.addEventListener('click', async () => {
            const value = getValue();
            if (!value || value === NA) return;
            const original = button.innerHTML;
            const copied = await copyText(String(value));
            button.innerHTML = icon(copied ? 'check' : 'x');
            button.classList.toggle('copy-failed', !copied);
            button.title = copied ? 'Copied' : 'Copy blocked by the browser';
            setTimeout(() => {
                button.innerHTML = original;
                button.classList.remove('copy-failed');
                button.removeAttribute('title');
            }, 1200);
        });
    }
    wireCopy(dom.copyEmergencyId, () => state.detail && state.detail.emergency_id);
    wireCopy(dom.copyCoords, () => dom.detailCoords.textContent);
    wireCopy(dom.copyDigipin, () => dom.detailDigipin.textContent);

    // ══════════════════════════════════════════════════════════════
    // Search + filters
    // ══════════════════════════════════════════════════════════════
    function setQuery(value) {
        state.query = value.trim();
        dom.listSearch.value = value;
        dom.globalSearch.value = value;
        dom.listSearchWrap.classList.toggle('has-value', Boolean(state.query));
        if (dom.globalSearchWrap) dom.globalSearchWrap.classList.toggle('has-value', Boolean(state.query));
        state.listSignature = null;
        renderList();
    }

    [dom.listSearch, dom.globalSearch].forEach((input) => {
        input.addEventListener('input', () => setQuery(input.value));
    });
    [dom.listSearchClear, dom.globalSearchClear].forEach((button) => {
        button.addEventListener('click', () => setQuery(''));
    });
    // The map carries no search field of its own: the console search box drives
    // both the queue and the map, so this wiring is optional.
    if (dom.mapSearch && dom.mapSearchClear && dom.mapSearchWrap) {
        dom.mapSearch.addEventListener('input', () => {
            setQuery(dom.mapSearch.value);
            dom.mapSearchWrap.classList.toggle('has-value', Boolean(dom.mapSearch.value.trim()));
            const first = filtered()[0];
            if (first && first.latitude !== null) MapModule.focusOn(first.latitude, first.longitude, 15);
        });
        dom.mapSearchClear.addEventListener('click', () => {
            dom.mapSearch.value = '';
            dom.mapSearchWrap.classList.remove('has-value');
            setQuery('');
        });
    }

    document.querySelectorAll('.filter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
            state.filter = chip.dataset.filter;
            setView('emergencies');
            state.listSignature = null;
            renderList();
        });
    });

    document.querySelectorAll('.metric[data-filter]').forEach((metric) => {
        metric.addEventListener('click', () => {
            const chip = document.querySelector(`.filter-chip[data-filter="${metric.dataset.filter}"]`);
            if (chip) chip.click();
        });
    });

    /** Mirror a toggle's state into the label carried inside its row. */
    function setToggleLabel(button, text) {
        const label = button.querySelector('.popover-state');
        if (label) label.textContent = text;
    }

    dom.sortBtn.addEventListener('click', () => {
        state.sortActiveFirst = !state.sortActiveFirst;
        dom.sortBtn.setAttribute('aria-pressed', String(state.sortActiveFirst));
        setToggleLabel(dom.sortBtn, state.sortActiveFirst ? 'On' : 'Off');
        state.listSignature = null;
        renderList();
    });
    dom.densityBtn.addEventListener('click', () => {
        const compact = dom.densityBtn.getAttribute('aria-pressed') !== 'true';
        dom.densityBtn.setAttribute('aria-pressed', String(compact));
        setToggleLabel(dom.densityBtn, compact ? 'On' : 'Off');
        document.documentElement.classList.toggle('compact-cards', compact);
    });

    /*
     * The queue header keeps a single chip. It opens a small panel holding the
     * queue-only filter, the ordering toggle and the row density toggle, so the
     * working view stays one line of chrome while nothing becomes unreachable.
     */
    (function wireFilterPanel() {
        const panel = $('filterPanel');
        const toggle = $('filterToggle');
        if (!panel || !toggle) return;

        const close = () => {
            dismiss(panel);
            toggle.setAttribute('aria-expanded', 'false');
        };
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const open = panel.hidden;
            if (open) {
                panel.classList.remove('is-leaving');
                panel.hidden = false;
            } else {
                dismiss(panel);
            }
            toggle.setAttribute('aria-expanded', String(open));
        });
        panel.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', close);
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    })();

    // ══════════════════════════════════════════════════════════════
    // Map chrome
    // ══════════════════════════════════════════════════════════════
    dom.mapZoomIn.addEventListener('click', () => MapModule.zoomBy(1));
    dom.mapZoomOut.addEventListener('click', () => MapModule.zoomBy(-1));
    dom.mapLocate.addEventListener('click', () => {
        const detail = state.detail;
        if (detail && detail.latitude !== null) MapModule.focusOn(detail.latitude, detail.longitude, 16);
        else if (detail && detail.locations && detail.locations.length) MapModule.fitToTrack(detail.locations);
        else MapModule.fitAll(all());
    });
    dom.mapLayers.addEventListener('click', () => {
        state.trackVisible = !state.trackVisible;
        dom.mapLayers.setAttribute('aria-pressed', String(state.trackVisible));
        MapModule.setTrackVisible(
            state.trackVisible,
            state.detail ? state.detail.locations : [],
            state.detail ? state.detail.status : null
        );
    });
    const MAP_TYPE_SELECTOR = '.switch-row [data-maptype]';
    document.querySelectorAll(MAP_TYPE_SELECTOR).forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll(MAP_TYPE_SELECTOR).forEach((b) => b.classList.toggle('active', b === button));
            MapModule.setBaseLayer(button.dataset.maptype);
        });
    });

    function setRefresh(ms) {
        state.refreshMs = ms;
        dom.refreshSelect.value = String(ms);
        dom.settingsRefresh.value = String(ms);
        setValue(dom.statusRefresh, `${ms / 1000}s`);
        try { localStorage.setItem('zeroui.dashboard.refresh', String(ms)); } catch (_) { /* ignore */ }
        scheduleTimers();
    }
    dom.refreshSelect.addEventListener('change', () => setRefresh(Number(dom.refreshSelect.value)));
    dom.settingsRefresh.addEventListener('change', () => setRefresh(Number(dom.settingsRefresh.value)));

    dom.soundToggle.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        dom.soundToggle.setAttribute('aria-pressed', String(state.soundEnabled));
        try { localStorage.setItem('zeroui.dashboard.sound', state.soundEnabled ? '1' : '0'); } catch (_) { /* ignore */ }
    });

    // ══════════════════════════════════════════════════════════════
    // Analytics
    // ══════════════════════════════════════════════════════════════
    function metricRow(name, value, foot, cls) {
        return `
            <div class="metric-row">
                <span class="metric-row-name">${escapeHtml(name)}</span>
                <span class="metric-row-foot">${escapeHtml(foot)}</span>
                <span class="metric-row-value ${cls || ''}">${value}</span>
            </div>`;
    }

    function barRow(name, value, total, color, iconName) {
        const pct = total ? Math.round((value / total) * 100) : 0;
        return `
            <div class="bar-row">
                <div class="bar-row-head">
                    <span class="bar-row-name">${icon(iconName || 'activity', 'icon')} ${escapeHtml(name)}</span>
                    <span class="bar-row-value">${value}</span>
                </div>
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
            </div>`;
    }

    function renderAnalytics() {
        const items = all();
        const total = items.length || 1;
        const active = items.filter((e) => e.status === 'emergency').length;
        const cancelled = items.filter((e) => e.status === 'cancelled').length;
        const resolved = items.filter((e) => e.status === 'resolved').length;
        const stale = items.filter((e) => e.connection_state === 'stale' && e.status === 'emergency').length;
        const withAudio = items.filter((e) => e.has_audio).length;
        const audioSeconds = items.reduce((sum, e) => sum + (e.audio_total_seconds || 0), 0);
        const events = items.reduce((sum, e) => sum + (e.event_count || 0), 0);
        const durations = items.map((e) => e.duration_seconds).filter((d) => typeof d === 'number');
        const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

        dom.analyticsKpis.innerHTML = `
            <div class="metric-table">
                ${metricRow('Total incidents', items.length, 'every recorded emergency')}
                ${metricRow('Active now', active, 'currently streaming', 'danger')}
                ${metricRow('Stale', stale, 'no update within the stale window')}
                ${metricRow('Resolved', resolved, 'closed after activation', 'success')}
                ${metricRow('Cancelled', cancelled, 'withdrawn by the user', 'warning')}
                ${metricRow('Average duration', fmtDuration(avg), 'activation to close')}
                ${metricRow('Audio captured', fmtDuration(audioSeconds), `${withAudio} incidents with audio`)}
                ${metricRow('Timeline events', events, 'across all incidents')}
            </div>`;

        dom.analyticsStatusBars.innerHTML =
            barRow('Active', active, total, 'var(--danger)', 'alert') +
            barRow('Stale', stale, total, 'var(--text-3)', 'clock') +
            barRow('Cancelled', cancelled, total, 'var(--warning)', 'x') +
            barRow('Resolved', resolved, total, 'var(--success)', 'check');

        const triggers = {};
        items.forEach((e) => { triggers[e.trigger_type] = (triggers[e.trigger_type] || 0) + 1; });
        const colors = {
            fall: 'var(--danger)',
            manual: 'var(--accent)',
            shake: 'var(--accent-strong)',
            test: 'var(--text-3)',
        };
        const entries = Object.entries(triggers).sort((a, b) => b[1] - a[1]);
        dom.analyticsTriggerBars.innerHTML = entries.length
            ? entries.map(([type, count]) => barRow(
                triggerLabel(type), count, total, colors[type] || 'var(--accent)', 'activity'
            )).join('')
            : PLACEHOLDER('No incidents recorded yet');
    }

    // ══════════════════════════════════════════════════════════════
    // Reports
    // ══════════════════════════════════════════════════════════════
    function renderReports() {
        const items = sorted();
        dom.reportsMeta.textContent = items.length
            ? `${items.length} incident${items.length === 1 ? '' : 's'} on record`
            : 'No incidents recorded';

        if (items.length === 0) {
            dom.reportsTable.innerHTML = '<tbody><tr><td><span class="telemetry-empty">No incidents recorded</span></td></tr></tbody>';
            return;
        }

        const rows = items.map((em) => {
            const status = displayStatus(em);
            const meta = STATUS_META[status];
            return `
                <tr>
                    <td class="strong">${escapeHtml(em.user_id)}</td>
                    <td><span class="status-pill ${status}">${icon(meta.icon, 'icon')} ${meta.label}</span></td>
                    <td>${escapeHtml(triggerLabel(em.trigger_type))}</td>
                    <td>${em.digipin ? `<code>${escapeHtml(em.digipin)}</code>` : NA}</td>
                    <td>${fmtDuration(em.duration_seconds)}</td>
                    <td>${em.audio_segment_count || 0}</td>
                    <td>${em.event_count || 0}</td>
                    <td>${fullTime(em.created_at)}</td>
                </tr>`;
        }).join('');

        dom.reportsTable.innerHTML = `
            <thead><tr>
                <th>Device</th><th>Status</th><th>Trigger</th><th>DIGIPIN</th>
                <th>Duration</th><th>Audio</th><th>Events</th><th>Opened</th>
            </tr></thead>
            <tbody>${rows}</tbody>`;
    }

    dom.reportsExport.addEventListener('click', () => {
        const items = sorted();
        if (items.length === 0) { notice('Nothing to export yet'); return; }
        const header = [
            'emergency_id', 'user_id', 'status', 'connection_state', 'trigger_type',
            'latitude', 'longitude', 'digipin', 'duration_seconds',
            'audio_segments', 'events', 'created_at', 'ended_at',
        ];

        // Quote only the fields that need it, so the file opens cleanly anywhere.
        const cell = (value) => {
            const text = value === null || value === undefined ? '' : String(value);
            if (!/[",\n]/.test(text)) return text;
            return '"' + text.split('"').join('""') + '"';
        };

        const rows = items.map((em) => [
            em.emergency_id, em.user_id, em.status, em.connection_state, em.trigger_type,
            em.latitude, em.longitude, em.digipin, em.duration_seconds,
            em.audio_segment_count || 0, em.event_count || 0, em.created_at, em.ended_at || '',
        ].map(cell).join(','));

        const csv = [header.join(',')].concat(rows).join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `zeroui-incidents-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    });

    // ══════════════════════════════════════════════════════════════
    // Settings
    // ══════════════════════════════════════════════════════════════
    function renderSettings() {
        dom.settingsSession.innerHTML = [
            kvRow('Operator', ApiClient.operator || 'authority'),
            kvRow('Role', 'authority'),
            kvRow('Session', ApiClient.hasSession() ? 'active' : 'signed out'),
            kvRow('Incidents cached', all().length),
        ].join('');

        const cfg = state.serverConfig || {};
        dom.settingsServer.innerHTML = [
            kvRow('Countdown', cfg.countdown_seconds !== undefined ? `${cfg.countdown_seconds}s` : NA),
            kvRow('Location interval', cfg.location_interval_seconds !== undefined ? `${cfg.location_interval_seconds}s` : NA),
            kvRow('Audio segment', cfg.audio_segment_seconds !== undefined ? `${cfg.audio_segment_seconds}s` : NA),
            kvRow('Stale after', cfg.stale_after_seconds !== undefined ? `${cfg.stale_after_seconds}s` : NA),
            kvRow('DIGIPIN library', cfg.digipin ? (cfg.digipin.library_available ? 'available' : 'missing') : NA),
            kvRow('DIGIPIN example', cfg.digipin ? cfg.digipin.format_example : NA),
        ].join('');

        const rt = state.realtime || {};
        dom.settingsRealtime.innerHTML = [
            kvRow('Dashboard sockets', rt.dashboard_sockets),
            kvRow('Device sockets', rt.device_sockets),
            kvRow('Live audio incidents', rt.live_audio_emergencies),
            kvRow('Live audio listeners', rt.live_audio_listeners),
            kvRow('Broadcasts sent', rt.dashboard_broadcasts),
            kvRow('Connection', ApiClient.token ? (dom.connectionBadge.dataset.state || 'closed') : 'closed'),
        ].join('');
    }

    // ══════════════════════════════════════════════════════════════
    // Timers
    // ══════════════════════════════════════════════════════════════
    function clearTimers() {
        state.timers.forEach((id) => clearInterval(id));
        state.timers = [];
    }

    function scheduleTimers() {
        clearTimers();
        // Relative times + derived staleness, without rebuilding the list.
        state.timers.push(setInterval(() => {
            if (state.detail) updateDetailHeader(state.detail);
            document.querySelectorAll('.card-time').forEach((el) => {
                const id = el.closest('.emergency-card').dataset.emergencyId;
                const em = state.emergencies.get(id);
                if (em) el.textContent = timeAgo(em.last_update_at || em.created_at);
            });
        }, 5000));

        state.timers.push(setInterval(() => {
            maybeRefreshSelectedDetail(false);
            refreshLiveAudioState();
        }, state.refreshMs));

        state.timers.push(setInterval(async () => {
            try {
                const data = await ApiClient.listEmergencies({ limit: 200 });
                (data.emergencies || []).forEach((em) => state.emergencies.set(em.emergency_id, em));
                renderAll();
            } catch (_) { /* socket will recover */ }
        }, Math.max(30000, state.refreshMs * 3)));
    }

    function renderAll() {
        renderList();
        renderCounts();
        // The map always reflects the whole incident store, not just the
        // selected incident, and centres on the newest active one once.
        MapModule.updateMarkers(all());
        MapModule.autoFocus(all());
        if (document.querySelector('.view[data-view="analytics"]').classList.contains('active')) renderAnalytics();
        if (document.querySelector('.view[data-view="reports"]').classList.contains('active')) renderReports();
    }

    // ══════════════════════════════════════════════════════════════
    // Boot
    // ══════════════════════════════════════════════════════════════
    async function boot() {
        MapModule.init();
        MapModule.setTheme(true);          // the console is dark; tiles follow
        try {
            const snapshot = await ApiClient.snapshot();
            state.serverConfig = snapshot.server_config || {};
            state.staleAfter = state.serverConfig.stale_after_seconds || 90;
            state.realtime = snapshot.realtime || {};
            (snapshot.emergencies || []).forEach((em) => state.emergencies.set(em.emergency_id, em));
            renderAll();
            if (state.selectedId) await maybeRefreshSelectedDetail(true);
        } catch (error) {
            console.error('Snapshot failed', error);
        }
        startRealtime();
        scheduleTimers();
        requestAnimationFrame(() => { moveTabInk(); MapModule.invalidateSize(); });
    }

    // Restore preferences
    (function restorePrefs() {
        idleWaveform();
        try {
            const savedSound = localStorage.getItem('zeroui.dashboard.sound');
            state.soundEnabled = savedSound === null ? true : savedSound === '1';
        } catch (_) { /* ignore */ }
        dom.soundToggle.setAttribute('aria-pressed', String(state.soundEnabled));

        try {
            const savedRefresh = Number(localStorage.getItem('zeroui.dashboard.refresh'));
            if ([5000, 10000, 30000, 60000].includes(savedRefresh)) state.refreshMs = savedRefresh;
        } catch (_) { /* ignore */ }
        dom.refreshSelect.value = String(state.refreshMs);
        dom.settingsRefresh.value = String(state.refreshMs);
    })();

    const operator = ApiClient.operator || 'authority';
    dom.operatorName.textContent = operator;
    dom.operatorAvatar.textContent = operator.charAt(0).toUpperCase();
    dom.avatarBtn.textContent = operator.charAt(0).toUpperCase();
    dom.statusOperator.textContent = operator;
    dom.statusRefresh.textContent = `${state.refreshMs / 1000}s`;

    /**
     * Enter the console, or ask for the token.
     *
     * A stored session wins. Failing that we try the server's development
     * shortcut, which is the normal path on the machine that owns `.env`; the
     * server refuses it outside development, and only then does the token card
     * appear. The overlay is deliberately not flashed while that call is in
     * flight, so a working console never shows a login screen at all.
     */
    async function enterConsole() {
        if (ApiClient.hasSession()) {
            dom.loginOverlay.classList.remove('visible');
            boot();
            return;
        }

        applyOperator();
        if (await ApiClient.devSession()) {
            dom.loginOverlay.classList.remove('visible');
            boot();
            return;
        }

        applyOperator();
        dom.loginOverlay.classList.add('visible');
        setConnectionBadge('closed');
        MapModule.init();
        setTimeout(() => { MapModule.init(); MapModule.setTheme(true); }, 0);
    }

    function applyOperator() {
        const name = ApiClient.operator || 'authority';
        dom.operatorName.textContent = name;
        dom.operatorAvatar.textContent = name.charAt(0).toUpperCase();
        dom.statusOperator.textContent = name;
    }

    enterConsole();

    renderEmptyDetail();
    renderList();
    renderCounts();
    renderSettings();

    window.addEventListener('resize', () => {
        MapModule.invalidateSize();
        moveTabInk();
    });
    window.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            setView('emergencies');
            dom.globalSearch.focus();
        }
    });

    // ══════════════════════════════════════════════════════════
    // Console surface
    // ══════════════════════════════════════════════════════════
    /**
     * Both surfaces are dark; the choice trades panel lift for a deeper black
     * on low-light shifts. It is a presentation switch only — no data or map
     * behaviour depends on it.
     */
    function setSurface(name) {
        const surface = name === 'deep' ? 'deep' : 'graphite';
        document.documentElement.setAttribute('data-surface', surface);
        document.querySelectorAll('[data-surface-set]').forEach((cell) => {
            cell.setAttribute('aria-pressed', String(cell.dataset.surfaceSet === surface));
        });
        try { localStorage.setItem('zeroui.dashboard.surface', surface); } catch (_) { /* ignore */ }
    }
    document.querySelectorAll('[data-surface-set]').forEach((cell) => {
        cell.addEventListener('click', () => setSurface(cell.dataset.surfaceSet));
    });
    setSurface(document.documentElement.getAttribute('data-surface'));

    window.showDetail = showDetail;
})();
