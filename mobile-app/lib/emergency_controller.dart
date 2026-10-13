import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:path_provider/path_provider.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'api.dart';
import 'audio.dart';
import 'config.dart';
import 'foreground.dart';
import 'models.dart';
import 'sensors.dart';
import 'telemetry.dart';

enum AppPhase {
  /// Loading configuration / recovering an in-flight emergency.
  booting,

  /// First-time setup: permissions + PIN + identity.
  onboarding,

  /// Monitoring sensors, no emergency.
  passive,

  /// The 15-second cancel window after a detected drop/fall.
  countdown,

  /// Emergency is live: location, audio, timeline streaming to the backend.
  active,

  /// Emergency ended, summary shown.
  recovered,
}

/// Orchestrates the whole mobile flow:
///
/// passive → (fall detected) → 15 s countdown → PIN cancel *or* activation →
/// live session (GPS every 30 s, audio segments + live stream, events,
/// telemetry) → resolve → recovered.
///
/// It owns the device's only emergency: the backend additionally enforces one
/// active emergency per user, so a duplicate activation is impossible even
/// after a process restart.
class EmergencyController extends ChangeNotifier with WidgetsBindingObserver {
  EmergencyController({required this.store, required this.permissions});

  final SessionStore store;
  final PermissionService permissions;

  late ApiClient api;
  late Outbox outbox;
  late TelemetryCollector telemetry;
  late FallDetector fallDetector;
  AudioCaptureService? _audio;

  AppPhase phase = AppPhase.booting;
  ServerConfig serverConfig = const ServerConfig();
  DeviceDescription device = DeviceDescription.unknown;

  EmergencySession? session;
  Duration countdownTotal = Duration(seconds: AppConfig.countdownSeconds);
  int countdownRemaining = AppConfig.countdownSeconds;
  String? lastDetectionSummary;

  final List<AppEvent> events = <AppEvent>[];
  String? notice; // transient user-facing message
  String? lastError;

  double accelerometerMagnitude = 0;
  bool accelerometerAvailable = false;
  bool recording = false;
  bool liveAudioEnabled = false;
  bool deviceSocketConnected = false;
  bool backendReachable = false;
  int queuedItems = 0;
  String? lastDigipin;

  /// Microphone grant state, kept fresh for the passive screen so the handset
  /// never implies it can capture audio when it cannot.
  bool microphoneGranted = false;

  /// True while the monitoring foreground service is running. This is what
  /// keeps the trigger reachable with the app closed and the screen off.
  bool monitoringServiceRunning = false;

  /// True once the native side reports the three-press detector armed.
  bool hardwareTriggerArmed = false;

  /// When the hardware trigger last fired, shown on the ACTIVE screen.
  DateTime? lastHardwareTriggerAt;

  Timer? _countdownTimer;
  Timer? _locationTimer;
  Timer? _telemetryTimer;
  Timer? _flushTimer;
  Timer? _notificationTimer;

  WebSocketChannel? _socket;
  StreamSubscription<dynamic>? _socketSubscription;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  bool _ending = false;

  AppLifecycleState _lifecycle = AppLifecycleState.resumed;

  // ══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════════════════════════

  Future<void> initialize() async {
    try {
      api = ApiClient(store: store);
      telemetry = TelemetryCollector();

      Directory outboxDir;
      try {
        final documents = await getApplicationDocumentsDirectory();
        outboxDir = Directory('${documents.path}/zeroui-outbox');
      } catch (e) {
        debugPrint('Zero UI: getApplicationDocumentsDirectory failed: $e');
        outboxDir = Directory('${Directory.systemTemp.path}/zeroui-outbox');
      }

      outbox = Outbox(
        store: store,
        api: api,
        directory: outboxDir,
      );

      try {
        await outbox.refreshPending();
        queuedItems = outbox.pending;
      } catch (e) {
        debugPrint('Zero UI: outbox.refreshPending failed: $e');
      }

      try {
        device = await telemetry.device();
      } catch (e) {
        debugPrint('Zero UI: telemetry.device failed: $e');
      }

      try {
        fallDetector = FallDetector(
          settings: store.detection,
          onFall: _onFallDetected,
          onSample: (magnitude) {
            accelerometerMagnitude = magnitude;
          },
          onAvailabilityChanged: (available) {
            accelerometerAvailable = available;
            notifyListeners();
          },
        );
      } catch (e) {
        debugPrint('Zero UI: fallDetector init failed: $e');
      }

      if (!store.onboardingComplete || !store.hasPin) {
        phase = AppPhase.onboarding;
        notifyListeners();
        return;
      }

      // If already onboarded, restore identity with timeout so offline backend never blocks app launch
      try {
        await _restoreIdentity().timeout(const Duration(seconds: 4));
      } catch (e) {
        debugPrint('Zero UI: _restoreIdentity failed/timed out: $e');
      }

      try {
        await _refreshServerConfig().timeout(const Duration(seconds: 4));
      } catch (e) {
        debugPrint('Zero UI: _refreshServerConfig failed/timed out: $e');
      }

      try {
        await resumeIfEmergencyActive().timeout(const Duration(seconds: 4));
      } catch (e) {
        debugPrint('Zero UI: resumeIfEmergencyActive failed/timed out: $e');
      }

      if (phase != AppPhase.active) {
        phase = AppPhase.passive;
      }

      try {
        fallDetector.start();
      } catch (_) {}

      _startHousekeepingTimers();
      _invalidateNotification();

      if (phase == AppPhase.passive) {
        try {
          await startMonitoring();
        } catch (_) {}
        try {
          await refreshCapabilities();
        } catch (_) {}
      }
    } catch (criticalError, stack) {
      debugPrint('Zero UI: Critical error in initialize: $criticalError\n$stack');
      lastError = criticalError.toString();
      // Ensure we NEVER remain stranded on booting phase
      phase = (!store.onboardingComplete || !store.hasPin)
          ? AppPhase.onboarding
          : AppPhase.passive;
    } finally {
      notifyListeners();
    }
  }

  Future<void> _restoreIdentity() async {
    final deviceId = store.deviceId;
    final token = store.deviceToken;
    if (deviceId != null && token != null) {
      api.identity = DeviceIdentity(deviceId: deviceId, deviceToken: token, userId: store.userId);
    }
    try {
      await ensureEnrolled();
      backendReachable = true;
      await outbox.flush();
      queuedItems = outbox.pending;
    } on ApiException catch (error) {
      backendReachable = false;
      lastError = error.message;
    } catch (error) {
      backendReachable = false;
      lastError = 'Backend unreachable: $error';
    }
  }

  Future<ServerConfig> _refreshServerConfig() async {
    try {
      serverConfig = await api.fetchConfig();
      countdownTotal = Duration(seconds: serverConfig.countdownSeconds);
      backendReachable = true;
    } catch (_) {
      backendReachable = false;
    }
    return serverConfig;
  }

  /// Enrol this device if it does not have a token yet.
  Future<DeviceIdentity> ensureEnrolled() async {
    if (api.identity != null) return api.identity!;
    final identity = await api.enroll(
      userId: store.userId,
      displayName: store.displayName.isEmpty ? '${store.userId} phone' : store.displayName,
      capabilities: await telemetry.capabilities(
        microphoneGranted: await permissions.isGranted('microphone'),
        accelerometerWorking: accelerometerAvailable,
      ),
      device: device.toJson(),
    );
    return identity;
  }

  void _startHousekeepingTimers() {
    _flushTimer ??= Timer.periodic(const Duration(seconds: 15), (_) async {
      if (outbox.pending > 0) {
        await outbox.flush();
      }
      queuedItems = outbox.pending;
      if (queuedItems == 0) {
        try {
          await ensureEnrolled();
          backendReachable = true;
        } catch (_) {
          backendReachable = false;
        }
      }
      notifyListeners();
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // Recovery after process death / backgrounding
  // ══════════════════════════════════════════════════════════════════

  Future<void> resumeIfEmergencyActive() async {
    EmergencyRef? remote;
    try {
      remote = await api.activeEmergency();
    } catch (_) {
      remote = null;
    }

    final localId = store.activeEmergencyId;
    if (remote == null && localId == null) {
      await store.saveActiveEmergency(null, null);
      return;
    }

    if (remote == null && localId != null) {
      // The device thinks an emergency is active but the backend says it ended
      // (e.g. the authority resolved it while the phone was offline).
      await _stopSession(keepSummary: true);
      session = EmergencySession(
        emergencyId: localId,
        triggerType: 'unknown',
        startedAt: DateTime.tryParse(store.activeEmergencyStartedAt ?? '') ?? DateTime.now(),
        resolved: true,
        status: 'resolved',
      );
      phase = AppPhase.recovered;
      notice = 'The previous emergency was ended while this phone was offline.';
      return;
    }

    await _resumeSession(remote!);
  }

  Future<void> _resumeSession(EmergencyRef remote) async {
    session = EmergencySession(
      emergencyId: remote.emergencyId,
      triggerType: remote.triggerType,
      startedAt: DateTime.tryParse(store.activeEmergencyStartedAt ?? remote.createdAt ?? '') ??
          DateTime.now(),
      digipin: remote.digipin,
      digipinAvailable: remote.digipinAvailable,
      location: remote.latitude != null && remote.longitude != null
          ? LocationSample(
              latitude: remote.latitude!,
              longitude: remote.longitude!,
              timestamp: remote.lastUpdateAt ?? nowIso(),
              digipin: remote.digipin,
            )
          : null,
    );
    lastDigipin = remote.digipin;
    phase = AppPhase.active;
    _addEvent('session_resumed',
        'Emergency ${remote.emergencyId} recovered after an app/process restart');
    await store.saveActiveEmergency(remote.emergencyId, session!.startedAt.toIso8601String());
    await _startSessionInfrastructure();
    notifyListeners();
  }

  // ══════════════════════════════════════════════════════════════════
  // Fall detection → countdown
  // ══════════════════════════════════════════════════════════════════

  void _onFallDetected(FallDetection detection) {
    if (phase != AppPhase.passive) return;
    lastDetectionSummary =
        'Impact ${detection.impactMagnitude.toStringAsFixed(1)} m/s² · '
        'free-fall ${detection.freefallMs} ms · still ${detection.inactivityMs} ms';
    _addEvent('fall_detected',
        'Possible fall: $lastDetectionSummary', detection.toJson());
    startCountdown(triggerType: 'fall');
  }

  /// Start the 10-second cancel window. Also used by the manual SOS button and
  /// the developer test helper.
  void startCountdown({String triggerType = 'fall', Map<String, dynamic>? metadata}) {
    if (phase == AppPhase.countdown || phase == AppPhase.active) return;
    if (phase != AppPhase.passive) return;

    phase = AppPhase.countdown;
    final window = serverConfig.countdownSeconds > 0
        ? serverConfig.countdownSeconds
        : AppConfig.countdownSeconds;
    countdownTotal = Duration(seconds: window);
    countdownRemaining = window;
    _addEvent('countdown_started',
        '$countdownRemaining-second verification window started (trigger: $triggerType)',
        metadata ?? {});

    WakelockPlus.enable();
    _vibratePattern();

    // Capture opens here, not at activation. If the window expires this same
    // buffer becomes the emergency's first audio segment — which is why the
    // first one is shorter than the rest. If the user presses I'M SAFE the
    // buffer is thrown away and nothing is ever uploaded.
    unawaited(_startVerificationAudio());

    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      countdownRemaining -= 1;
      if (countdownRemaining == 5) HapticFeedback.heavyImpact();
      if (countdownRemaining <= 0) {
        timer.cancel();
        _countdownTimer = null;
        _activateEmergency(triggerType: triggerType, metadata: metadata);
      }
      notifyListeners();
    });
    notifyListeners();
  }

  void _vibratePattern() {
    // Escalating feedback so the user notices without looking at the screen.
    HapticFeedback.vibrate();
    Future<void>.delayed(const Duration(milliseconds: 300), HapticFeedback.heavyImpact);
    Future<void>.delayed(const Duration(milliseconds: 700), HapticFeedback.heavyImpact);
  }

  /// "I'm safe": requires the PIN. On success **nothing** is sent to the
  /// authority dashboard — no emergency record is ever created for this event.
  Future<bool> confirmSafeWithPin(String pin, {bool localOnly = false}) async {
    if (phase != AppPhase.countdown) return false;

    final localOk = store.verifyPin(pin);
    var remoteOk = false;
    if (!localOk && !localOnly) {
      try {
        remoteOk = await api.verifyPin(store.userId, pin);
      } catch (_) {
        remoteOk = false;
      }
    }

    if (!localOk && !remoteOk) {
      _addEvent('wrong_pin', 'Incorrect safety PIN entered — countdown continues');
      notifyListeners();
      return false;
    }

    _countdownTimer?.cancel();
    _countdownTimer = null;
    WakelockPlus.disable();

    _addEvent('user_safe',
        'User confirmed they are safe with the PIN — no emergency was created');
    // Keep only the local trail in memory; it is never uploaded.
    events.clear();
    store.saveTrail(const []);
    phase = AppPhase.passive;
    notice = 'Cancelled — no emergency was created.';
    notifyListeners();
    return true;
  }

  /// "I'm safe", pressed on the verification screen.
  ///
  /// The verification screen is a single, deliberately large target, so the
  /// press itself is the confirmation and there is no PIN step here: the window
  /// is only ten seconds, and a keypad that cannot be completed in time would
  /// turn a false detection into a dispatched emergency.
  ///
  /// Nothing is sent to the authority. No emergency record is created, the
  /// verification audio is discarded, and the local trail is cleared.
  Future<void> confirmSafe() async {
    if (phase != AppPhase.countdown) return;

    _countdownTimer?.cancel();
    _countdownTimer = null;
    await WakelockPlus.disable();

    // `flush: false` drops the buffer instead of emitting a final segment, so
    // no audio from this event can reach the backend by any route.
    await _audio?.stop(flush: false);
    await _audio?.dispose();
    _audio = null;
    recording = false;

    _addEvent('user_safe',
        "User pressed I'M SAFE during verification — no emergency was created");
    events.clear();
    await store.saveTrail(const []);
    phase = AppPhase.passive;
    notice = 'Cancelled — no emergency was created.';
    await startMonitoring();
    notifyListeners();
  }

  /// Activate immediately, with no cancellation window.
  ///
  /// This is the hardware path. Three deliberate presses already are the
  /// confirmation, so asking again would only delay the authority seeing the
  /// incident.
  Future<void> triggerImmediateEmergency({
    String triggerType = 'hardware',
    Map<String, dynamic>? metadata,
  }) async {
    if (phase == AppPhase.active) return;

    if (phase == AppPhase.countdown) {
      // A sensor detection may already be counting down; a deliberate gesture
      // outranks it and the window ends now.
      _countdownTimer?.cancel();
      _countdownTimer = null;
      await WakelockPlus.disable();
      _addEvent('countdown_overridden',
          'Hardware trigger arrived during verification — activating now');
    } else if (phase != AppPhase.passive && phase != AppPhase.recovered) {
      return;
    }

    lastHardwareTriggerAt = DateTime.now();
    lastDetectionSummary = 'Hardware trigger (3× volume-down)';
    _addEvent('hardware_trigger',
        'Emergency button pressed three times — activating immediately, no countdown');
    await _activateEmergency(
      triggerType: triggerType,
      metadata: {...?metadata, 'hardware': true, 'countdown_seconds': 0},
    );
  }

  /// Open the microphone for the verification window.
  ///
  /// Separate from [_startAudioCapture] because the intent differs: this audio
  /// may legitimately be discarded, whereas an active emergency's audio is
  /// always uploaded.
  Future<void> _startVerificationAudio() async {
    if (phase != AppPhase.countdown) return;
    _audio ??= AudioCaptureService(
      segmentSeconds: serverConfig.audioSegmentSeconds,
      firstSegmentSeconds: AppConfig.verificationAudioSeconds,
    );
    _audio!.onLiveFrame = _onLiveAudioFrame;
    _audio!.onSegment = _onAudioSegment;

    final started = await _audio!.start();
    recording = started;
    if (started) {
      _addEvent(
          'verification_audio_started',
          'Microphone opened during verification; the first '
              '${AppConfig.verificationAudioSeconds}s is kept only if this becomes an emergency');
    } else {
      _addEvent('audio_unavailable',
          'Microphone unavailable: ${_audio!.lastError ?? 'permission or device restriction'}');
      lastError = _audio!.lastError;
    }
    notifyListeners();
  }

  // ══════════════════════════════════════════════════════════════════
  // Background monitoring (keeps the hardware trigger reachable)
  // ══════════════════════════════════════════════════════════════════

  /// Keep the process alive while monitoring so the three-press trigger still
  /// works with the app closed.
  ///
  /// The service is deliberately quiet in this mode — a silent ongoing
  /// notification and nothing else. Detection stays in this isolate at the
  /// accelerometer's normal sample rate; the service exists only to stop
  /// Android from reclaiming the process.
  Future<void> startMonitoring() async {
    if (monitoringServiceRunning) return;
    try {
      final ok = await ForegroundServiceBridge().start(
        title: 'Zero UI monitoring',
        text: 'Watching sensors · press volume-down three times for emergency',
        mode: 'monitoring',
      );
      monitoringServiceRunning = ok;
      hardwareTriggerArmed = ok;
    } catch (error) {
      monitoringServiceRunning = false;
      hardwareTriggerArmed = false;
      lastError = 'Background monitoring service could not start: $error';
    }
    notifyListeners();
  }

  Future<void> stopMonitoring() async {
    if (!monitoringServiceRunning) return;
    await ForegroundServiceBridge().stop();
    monitoringServiceRunning = false;
    hardwareTriggerArmed = false;
    notifyListeners();
  }

  /// Refresh the two grant states the passive screen reports.
  Future<void> refreshCapabilities() async {
    try {
      microphoneGranted = await permissions.isGranted('microphone');
    } catch (_) {
      microphoneGranted = false;
    }
    try {
      monitoringServiceRunning = await ForegroundServiceBridge().isRunning();
      hardwareTriggerArmed = monitoringServiceRunning;
    } catch (_) {
      monitoringServiceRunning = false;
      hardwareTriggerArmed = false;
    }
    notifyListeners();
  }

  // ══════════════════════════════════════════════════════════════════
  // Activation
  // ══════════════════════════════════════════════════════════════════

  Future<void> _activateEmergency({
    required String triggerType,
    Map<String, dynamic>? metadata,
  }) async {
    phase = AppPhase.active;
    notifyListeners();

    var fix = await _acquireLocation();
    if (fix == null) {
      lastError = 'No GPS fix available — retrying before contacting the backend.';
      notifyListeners();
      // Give the device a short window to obtain a fix rather than creating an
      // emergency with a fabricated position.
      fix = await _acquireLocation(retries: 3);
    }
    if (fix == null) {
      lastError = 'Emergency could not be reported: no location fix on this device. '
          'Enable GPS / location services and try again.';
      _addEvent('activation_failed', 'No GPS fix available, activation aborted');
      phase = AppPhase.passive;
      notifyListeners();
      return;
    }
    final capabilities = await telemetry.capabilities(
      microphoneGranted: await _audioPermissionGranted(),
      accelerometerWorking: accelerometerAvailable,
    );

    try {
      final response = await api.startEmergency(
        triggerType: triggerType,
        location: fix,
        triggerMetadata: {...?metadata, 'trigger': triggerType},
        capabilities: capabilities,
        device: device.toJson(),
        countdownSeconds: serverConfig.countdownSeconds,
        clientEmergencyId: 'local-${SessionStore.newLocalId()}',
        events: List<AppEvent>.from(events),
      );

      final emergency = EmergencyRef.fromJson(
        (response['emergency'] as Map).cast<String, dynamic>(),
      );
      session = EmergencySession(
        emergencyId: emergency.emergencyId,
        triggerType: emergency.triggerType,
        startedAt: DateTime.now(),
        digipin: emergency.digipin,
        digipinAvailable: emergency.digipinAvailable,
        location: fix.withDigipin(emergency.digipin),
      );
      lastDigipin = emergency.digipin;
      backendReachable = true;
      await store.saveActiveEmergency(emergency.emergencyId, session!.startedAt.toIso8601String());
      await store.saveTrail(events.map((event) => event.toJson()).toList());

      _addEvent('sos_sent', 'Emergency reported to the backend (id ${emergency.emergencyId})');
      if (!emergency.digipinAvailable) {
        _addEvent('digipin_unavailable',
            'DIGIPIN not generated: this position is outside India\'s DIGIPIN coverage');
      }
      lastError = null;
      await _startSessionInfrastructure();
    } on ApiException catch (error) {
      if (error.statusCode == 409) {
        // The backend already has an active emergency for this user: adopt it
        // instead of creating a second one (also covers offline retries).
        _addEvent('duplicate_prevented',
            'An active emergency already exists for this user — adopting it');
        try {
          final existing = await api.activeEmergency();
          if (existing != null) {
            await _resumeSession(existing);
            return;
          }
        } catch (_) {}
      }
      lastError = 'Could not report the emergency: ${error.message}';
      _addEvent('activation_failed', lastError!);
      backendReachable = false;
      // Keep the session locally so the retry queue still has a target id.
      final pendingId = 'pending-${SessionStore.newLocalId()}';
      session = EmergencySession(
        emergencyId: pendingId,
        triggerType: triggerType,
        startedAt: DateTime.now(),
        location: fix,
      );
      await store.saveActiveEmergency(pendingId, session!.startedAt.toIso8601String());
      await outbox.enqueuePayload(
        type: 'event',
        emergencyId: pendingId,
        body: {
          'event_type': 'activation_pending',
          'description': 'Emergency activation is queued until connectivity returns',
        },
      );
    } catch (error) {
      lastError = 'Could not report the emergency: $error';
      _addEvent('activation_failed', lastError!);
    }
    notifyListeners();
  }

  Future<bool> _audioPermissionGranted() => permissions.isGranted('microphone');

  /// Ask the platform for a position (with a bounded wait), preferring a fresh
  /// fix and falling back to the last known one. Returns null when nothing is
  /// available — the app never invents coordinates.
  Future<LocationSample?> _acquireLocation({int retries = 1}) async {
    for (var attempt = 0; attempt < retries; attempt++) {
      try {
        final permission = await Geolocator.checkPermission();
        if (permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) {
          final requested = await Geolocator.requestPermission();
          if (requested == LocationPermission.denied ||
              requested == LocationPermission.deniedForever) {
            lastError = 'Location permission is required to report an emergency.';
            return null;
          }
        }
        if (!await Geolocator.isLocationServiceEnabled()) {
          lastError = 'Location services (GPS) are turned off on this device.';
          continue;
        }
        final position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 20),
          ),
        );
        return _toSample(position);
      } catch (error) {
        lastError = 'GPS fix failed: $error';
        try {
          final last = await Geolocator.getLastKnownPosition();
          if (last != null) return _toSample(last, provider: 'last_known');
        } catch (_) {}
      }
    }
    return null;
  }

  LocationSample _toSample(Position position, {String provider = 'gps'}) => LocationSample(
        latitude: position.latitude,
        longitude: position.longitude,
        timestamp: position.timestamp.toUtc().toIso8601String(),
        accuracy: position.accuracy,
        altitude: position.altitude,
        speed: position.speed,
        heading: position.heading,
        provider: provider,
        isMock: position.isMocked,
      );

  // ══════════════════════════════════════════════════════════════════
  // Live session infrastructure
  // ══════════════════════════════════════════════════════════════════

  Future<void> _startSessionInfrastructure() async {
    final current = session;
    if (current == null) return;

    // 1. Foreground service so Android keeps the process alive
    try {
      await ForegroundServiceBridge().start(
        title: 'Zero UI emergency active',
        text: 'Sharing location, audio and status with the dashboard',
      );
    } catch (error) {
      lastError = 'Foreground service could not start: $error';
      _addEvent('foreground_service_failed', lastError!);
    }

    // 2. Microphone (only now — after the emergency was actually triggered)
    await _startAudioCapture();

    // 3. Realtime socket
    _connectDeviceSocket();

    // 4. Periodic location (30 s) and telemetry (15 s)
    _locationTimer?.cancel();
    _locationTimer = Timer.periodic(
      Duration(seconds: serverConfig.locationIntervalSeconds),
      (_) => pushLocation(),
    );
    _telemetryTimer?.cancel();
    _telemetryTimer = Timer.periodic(const Duration(seconds: 15), (_) => pushTelemetry());

    // 5. Keep the ongoing notification honest
    _notificationTimer?.cancel();
    _notificationTimer = Timer.periodic(const Duration(seconds: 20), (_) => _invalidateNotification());

    await pushTelemetry();
    await pushLocation();
    notifyListeners();
  }

  Future<void> _startAudioCapture() async {
    if (session == null) return;
    // Capture usually already exists (it opened when verification started);
    // this only creates it when activation happened with no window at all,
    // which is the hardware trigger.
    _audio ??= AudioCaptureService(
      segmentSeconds: serverConfig.audioSegmentSeconds,
      firstSegmentSeconds: AppConfig.verificationAudioSeconds,
    );
    _audio!.onLiveFrame = _onLiveAudioFrame;
    _audio!.onSegment = _onAudioSegment;

    final started = await _audio!.start();
    recording = started;
    if (started) {
      _addEvent('audio_capture_started',
          'Microphone capture started (~${serverConfig.audioSegmentSeconds}s segments + live stream)');
    } else {
      _addEvent('audio_unavailable',
          'Microphone unavailable: ${_audio!.lastError ?? 'permission or device restriction'}');
      lastError = _audio!.lastError;
    }
    notifyListeners();
  }

  void _onLiveAudioFrame(Uint8List frame) {
    if (!liveAudioEnabled || !deviceSocketConnected) return;
    try {
      _socket?.sink.add(frame);
    } catch (_) {
      deviceSocketConnected = false;
    }
  }

  Future<void> _onAudioSegment(AudioSegment segment) async {
    final current = session;
    if (current == null) return;

    // An emergency may still be "pending" if activation never reached the
    // backend — queue the segment so it is uploaded once it does.
    if (current.emergencyId.startsWith('pending-')) {
      await outbox.enqueueSegment(
        emergencyId: current.emergencyId,
        sequence: segment.sequence,
        wav: segment.wav,
        durationSeconds: segment.durationSeconds,
        startedAt: segment.startedAt.toUtc().toIso8601String(),
        endedAt: segment.endedAt.toUtc().toIso8601String(),
      );
      queuedItems = outbox.pending;
      notifyListeners();
      return;
    }

    try {
      await api.uploadSegment(
        emergencyId: current.emergencyId,
        sequence: segment.sequence,
        wav: segment.wav,
        durationSeconds: segment.durationSeconds,
        startedAt: segment.startedAt.toUtc().toIso8601String(),
        endedAt: segment.endedAt.toUtc().toIso8601String(),
      );
      session = current.copyWith(
        segmentsUploaded: current.segmentsUploaded + 1,
        lastSyncAt: DateTime.now(),
      );
      _addEvent(
          'audio_segment', 'Audio segment #${segment.sequence} stored '
          '(${segment.durationSeconds.toStringAsFixed(1)}s)');
    } on ApiException catch (error) {
      if (error.isClientError) {
        _addEvent('audio_segment_rejected', 'Segment #${segment.sequence} rejected: ${error.message}');
      } else {
        await _queueSegment(current.emergencyId, segment);
      }
    } catch (_) {
      await _queueSegment(current.emergencyId, segment);
    }
    notifyListeners();
  }

  Future<void> _queueSegment(String emergencyId, AudioSegment segment) async {
    await outbox.enqueueSegment(
      emergencyId: emergencyId,
      sequence: segment.sequence,
      wav: segment.wav,
      durationSeconds: segment.durationSeconds,
      startedAt: segment.startedAt.toUtc().toIso8601String(),
      endedAt: segment.endedAt.toUtc().toIso8601String(),
    );
    queuedItems = outbox.pending;
    _addEvent('audio_segment_queued',
        'Segment #${segment.sequence} queued offline (retries automatically)');
  }

  // ── realtime socket ────────────────────────────────────────────────

  void _connectDeviceSocket() {
    final current = session;
    if (current == null || current.emergencyId.startsWith('pending-')) return;

    _socketSubscription?.cancel();
    _reconnectTimer?.cancel();

    try {
      final channel = WebSocketChannel.connect(api.deviceSocketUri(current.emergencyId));
      _socket = channel;
      _socketSubscription = channel.stream.listen(
        _onSocketMessage,
        onError: (Object error) {
          deviceSocketConnected = false;
          _scheduleReconnect();
        },
        onDone: () {
          deviceSocketConnected = false;
          notifyListeners();
          _scheduleReconnect();
        },
        cancelOnError: false,
      );
      deviceSocketConnected = true;
      _reconnectAttempts = 0;
      _addEvent('realtime_connected', 'Realtime channel to the backend opened');
    } catch (error) {
      deviceSocketConnected = false;
      _scheduleReconnect();
    }
    notifyListeners();
  }

  void _scheduleReconnect() {
    if (session == null || _ending) return;
    _reconnectTimer?.cancel();
    _reconnectAttempts += 1;
    final seconds = (2 * _reconnectAttempts).clamp(2, 30);
    _reconnectTimer = Timer(Duration(seconds: seconds), () {
      if (session == null || _ending) return;
      _connectDeviceSocket();
      // Anything sent while we were disconnected is flushed too.
      pushTelemetry();
      pushLocation();
    });
  }

  void _onSocketMessage(dynamic raw) {
    if (raw is! String) return;
    Map<String, dynamic> message;
    try {
      message = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (message['type']) {
      case 'ready':
        deviceSocketConnected = true;
        serverConfig = ServerConfig(
          countdownSeconds: serverConfig.countdownSeconds,
          locationIntervalSeconds:
              (message['location_interval_seconds'] as num?)?.toInt() ?? serverConfig.locationIntervalSeconds,
          audioSegmentSeconds:
              (message['audio_segment_seconds'] as num?)?.toInt() ?? serverConfig.audioSegmentSeconds,
          staleAfterSeconds:
              (message['stale_after_seconds'] as num?)?.toInt() ?? serverConfig.staleAfterSeconds,
          digipinAvailable: serverConfig.digipinAvailable,
        );
        break;
      case 'ack':
        if (message['kind'] == 'location' && message['digipin'] != null) {
          lastDigipin = message['digipin'] as String;
          final current = session;
          if (current?.location != null) {
            session = current!.copyWith(
              digipin: lastDigipin,
              location: current.location!.withDigipin(lastDigipin),
              lastSyncAt: DateTime.now(),
            );
          }
        }
        session = session?.copyWith(lastSyncAt: DateTime.now());
        break;
      case 'emergency.ended':
        final status = message['status'] as String? ?? 'resolved';
        _addEvent('emergency_ended_remotely', 'The authority ended this emergency ($status)');
        _finishSessionLocally(status: status, endedBy: message['ended_by'] as String? ?? 'dashboard');
        break;
      case 'live_audio.request':
        liveAudioEnabled = message['enabled'] == true;
        _addEvent('live_audio_request',
            'Dashboard ${liveAudioEnabled ? 'enabled' : 'disabled'} live audio listening');
        if (liveAudioEnabled) {
          _audio?.start().then((started) {
            recording = started;
            notifyListeners();
          });
        }
        break;
      default:
        break;
    }
    notifyListeners();
  }

  // ── periodic pushes ────────────────────────────────────────────────

  Future<void> pushLocation() async {
    final current = session;
    if (current == null || _ending) return;

    final sample = await _acquireLocation();
    if (sample == null) {
      _addEvent('gps_unavailable', lastError ?? 'No GPS fix for this interval');
      notifyListeners();
      return;
    }

    if (current.emergencyId.startsWith('pending-')) {
      await outbox.enqueuePayload(
        type: 'location',
        emergencyId: current.emergencyId,
        body: sample.toJson(),
      );
      queuedItems = outbox.pending;
      session = current.copyWith(location: sample);
      notifyListeners();
      return;
    }

    try {
      if (deviceSocketConnected) {
        _socket?.sink.add(jsonEncode({'type': 'location', 'data': sample.toJson()}));
        session = current.copyWith(location: sample, lastSyncAt: DateTime.now());
      } else {
        final digipin = await api.postLocation(current.emergencyId, sample);
        lastDigipin = digipin ?? lastDigipin;
        session = current.copyWith(
          location: sample.withDigipin(digipin),
          digipin: digipin ?? current.digipin,
          digipinAvailable: digipin != null || current.digipinAvailable,
          lastSyncAt: DateTime.now(),
        );
      }
      queuedItems = outbox.pending;
    } catch (_) {
      backendReachable = false;
      await outbox.enqueuePayload(
        type: 'location',
        emergencyId: current.emergencyId,
        body: sample.toJson(),
      );
      queuedItems = outbox.pending;
      session = current.copyWith(location: sample);
    }
    notifyListeners();
  }

  Future<void> pushTelemetry() async {
    final current = session;
    if (current == null) return;

    final capabilities = await telemetry.capabilities(
      microphoneGranted: await _audioPermissionGranted(),
      accelerometerWorking: accelerometerAvailable,
    );
    final payload = await telemetry.collect(
      foregroundServiceRunning: ForegroundServiceBridge.running,
      audioActive: recording,
      segmentSequence: _audio?.sequence ?? 0,
      capabilities: capabilities,
      accelerometerMagnitude: accelerometerAvailable ? accelerometerMagnitude : null,
      screenOn: _lifecycle == AppLifecycleState.resumed,
      appState: _lifecycle == AppLifecycleState.resumed ? 'foreground' : 'background_service',
    );

    if (current.emergencyId.startsWith('pending-')) {
      await outbox.enqueuePayload(
        type: 'telemetry',
        emergencyId: current.emergencyId,
        body: payload,
      );
      queuedItems = outbox.pending;
      notifyListeners();
      return;
    }

    try {
      if (deviceSocketConnected) {
        _socket?.sink.add(jsonEncode({'type': 'telemetry', 'data': payload}));
      } else {
        await api.postTelemetry(current.emergencyId, payload);
      }
      backendReachable = true;
    } catch (_) {
      backendReachable = false;
      await outbox.enqueuePayload(
        type: 'telemetry',
        emergencyId: current.emergencyId,
        body: payload,
      );
      queuedItems = outbox.pending;
    }
    notifyListeners();
  }

  void _addEvent(String type, String description, [Map<String, dynamic> payload = const {}]) {
    events.add(AppEvent(type: type, description: description, payload: payload));
    store.saveTrail(events.map((event) => event.toJson()).toList());

    final current = session;
    if (current != null && !current.emergencyId.startsWith('pending-')) {
      // Fire and forget: timeline entries are also queued on failure.
      api.postEvent(current.emergencyId, AppEvent(type: type, description: description, payload: payload))
          .catchError((Object error) async {
        if (error is ApiException && error.isClientError) return;
        await outbox.enqueuePayload(
          type: 'event',
          emergencyId: current.emergencyId,
          body: {
            'event_type': type,
            'description': description,
            'payload': payload,
          },
        );
        queuedItems = outbox.pending;
      });
    }
    notifyListeners();
  }

  // ══════════════════════════════════════════════════════════════════
  // Manual triggers / live audio control
  // ══════════════════════════════════════════════════════════════════

  /// Manual SOS (long press) — skips the countdown by design.
  void triggerManualSos() {
    if (phase != AppPhase.passive) return;
    _addEvent('manual_trigger', 'Manual SOS activated by the user on the phone');
    startCountdown(triggerType: 'manual', metadata: const {'manual': true});
  }

  /// Shake detection uses the same sensor pipeline as the fall detector.
  void triggerShakeSos() {
    if (phase != AppPhase.passive) return;
    _addEvent('shake_trigger', 'Three rapid shakes detected');
    startCountdown(triggerType: 'shake');
  }

  /// Development/test helper: replay a realistic drop into the *real* detector
  /// so the production algorithm runs end to end.
  Future<void> simulateDrop({bool fast = false}) async {
    if (phase != AppPhase.passive) return;
    _addEvent('test_trigger', 'Simulated drop sequence injected (developer mode)');
    final step = fast ? 20 : 50;
    fallDetector.injectSample(9.8);
    await Future<void>.delayed(Duration(milliseconds: step));
    for (var i = 0; i < 20; i++) {
      fallDetector.injectSample(2.0); // free fall
      await Future<void>.delayed(Duration(milliseconds: step));
    }
    fallDetector.injectSample(31.5); // impact
    await Future<void>.delayed(Duration(milliseconds: step));
    for (var i = 0; i < 60; i++) {
      fallDetector.injectSample(0.35); // static phone on the floor
      await Future<void>.delayed(Duration(milliseconds: step));
    }
  }

  void setLiveAudioEnabled(bool enabled) {
    liveAudioEnabled = enabled;
    _addEvent('live_audio_toggle', 'Live audio ${enabled ? 'enabled' : 'disabled'} locally');
    if (enabled && !recording) _audio?.start();
    notifyListeners();
  }

  // ══════════════════════════════════════════════════════════════════
  // Ending the emergency
  // ══════════════════════════════════════════════════════════════════

  /// User ends the emergency from the phone.
  Future<void> resolveEmergency({String? note}) => _endEmergency('resolved', note: note);

  /// User cancels an *already active* emergency (requires the PIN server-side).
  Future<bool> cancelActiveEmergency(String pin) async {
    final current = session;
    if (current == null) return false;

    if (!store.verifyPin(pin)) {
      var remoteOk = false;
      try {
        remoteOk = await api.verifyPin(store.userId, pin);
      } catch (_) {}
      if (!remoteOk) {
        _addEvent('wrong_pin', 'Incorrect PIN — the emergency stays active');
        notifyListeners();
        return false;
      }
    }

    await _endEmergency('cancelled', pin: pin, reason: 'user_confirmed_safe');
    return true;
  }

  Future<void> _endEmergency(String status, {String? pin, String? reason, String? note}) async {
    final current = session;
    if (current == null) return;
    _ending = true;

    // Flush audio first so the final segment is captured, then stop capture.
    await _audio?.stop();
    recording = false;

    try {
      if (!current.emergencyId.startsWith('pending-')) {
        await api.endEmergency(
          current.emergencyId,
          status,
          pin: pin,
          pinVerified: pin != null,
          reason: reason,
          note: note,
        );
      } else {
        await outbox.enqueuePayload(
          type: 'end',
          emergencyId: current.emergencyId,
          body: {'status': status, 'reason': ?reason, 'note': ?note},
        );
      }
    } catch (_) {
      if (!current.emergencyId.startsWith('pending-')) {
        await outbox.enqueuePayload(
          type: 'end',
          emergencyId: current.emergencyId,
          body: {'status': status, 'reason': ?reason, 'note': ?note},
        );
      }
    }

    _addEvent(status == 'cancelled' ? 'emergency_cancelled' : 'emergency_resolved',
        status == 'cancelled'
            ? 'User cancelled the emergency with the safety PIN'
            : 'Emergency resolved${note != null && note.isNotEmpty ? ' — $note' : ''}');
    _finishSessionLocally(status: status, endedBy: 'device');
    _ending = false;
  }

  void _finishSessionLocally({required String status, String? endedBy}) {
    final current = session;
    session = current?.copyWith(resolved: true, status: status);
    _stopSession(keepSummary: true);
    notifyListeners();
  }

  Future<void> _stopSession({required bool keepSummary}) async {
    _countdownTimer?.cancel();
    _countdownTimer = null;
    _locationTimer?.cancel();
    _locationTimer = null;
    _telemetryTimer?.cancel();
    _telemetryTimer = null;
    _notificationTimer?.cancel();
    _notificationTimer = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;

    await _socketSubscription?.cancel();
    _socketSubscription = null;
    try {
      await _socket?.sink.close();
    } catch (_) {}
    _socket = null;
    deviceSocketConnected = false;

    await _audio?.stop();
    recording = false;
    liveAudioEnabled = false;

    await ForegroundServiceBridge().stop();
    monitoringServiceRunning = false;
    hardwareTriggerArmed = false;
    await WakelockPlus.disable();
    await store.saveActiveEmergency(null, null);

    if (!keepSummary) {
      session = null;
    }
  }

  /// Dismiss the recovery screen and go back to monitoring.
  void dismissRecovery() {
    session = null;
    events.clear();
    phase = store.onboardingComplete && store.hasPin ? AppPhase.passive : AppPhase.onboarding;
    notice = null;
    _startHousekeepingTimers();
    fallDetector.start();
    unawaited(startMonitoring());
    notifyListeners();
  }

  // ══════════════════════════════════════════════════════════════════
  // Setup helpers used by the UI
  // ══════════════════════════════════════════════════════════════════

  Future<void> completeOnboarding() async {
    store.onboardingComplete = true;
    await _restoreIdentity();
    await _refreshServerConfig();
    fallDetector.start();
    _startHousekeepingTimers();
    phase = AppPhase.passive;
    _invalidateNotification();
    await startMonitoring();
    await refreshCapabilities();
    notifyListeners();
  }

  Future<bool> setPin(String pin, {String? currentPin}) async {
    final localChanged = await _storePinLocally(pin);
    if (!localChanged) {
      lastError = 'PIN must be exactly 4 digits';
      notifyListeners();
      return false;
    }
    try {
      await ensureEnrolled();
      await api.setPin(store.userId, pin, currentPin: currentPin);
      lastError = null;
    } on ApiException catch (error) {
      // Roll the local change back so the app and the backend stay in sync.
      lastError = 'Backend rejected the PIN: ${error.message}';
      if (currentPin != null || store.hasPin) {
        // Re-saving the previous PIN restores the old hash; with no previous
        // PIN the local entry must be cleared instead.
        if (currentPin != null) {
          await _storePinLocally(currentPin);
        } else {
          await store.clearPin();
        }
      }
      notifyListeners();
      return false;
    } catch (error) {
      // Offline: the local PIN stays active (cancelling works offline via the
      // local hash + remote fallback). The plaintext is deliberately not
      // stored, so it cannot be re-pushed later — the user must save again
      // once the backend is reachable.
      lastError =
          'PIN saved on this phone only — the backend is unreachable ($error). '
          'Cancelling still works offline. Re-save the PIN once connected.';
      notifyListeners();
      return true;
    }
    notifyListeners();
    return true;
  }

  /// True when the backend holds a PIN for this user (used to decide whether
  /// the current PIN must be requested before a change).
  Future<bool> backendHasPin() async {
    try {
      await ensureEnrolled();
      return await api.hasBackendPin(store.userId);
    } catch (_) {
      return false;
    }
  }

  Future<bool> _storePinLocally(String pin) async {
    if (!RegExp(r'^\d{4}$').hasMatch(pin)) return false;
    await store.savePinHash(pin);
    return true;
  }

  Future<void> updateDetectionSettings(DetectionSettings settings) async {
    await store.saveDetection(settings);
    fallDetector.updateSettings(settings);
    notifyListeners();
  }

  Future<void> updateEndpoint({String? apiBase, String? enrollmentToken, String? userId}) async {
    if (apiBase != null) store.apiBase = apiBase;
    if (enrollmentToken != null) store.enrollmentToken = enrollmentToken;
    if (userId != null) store.userId = userId;
    await store.clearDevice();
    api = ApiClient(store: store);
    outbox = Outbox(store: store, api: api, directory: outbox.directory);
    await _restoreIdentity();
    await _refreshServerConfig();
    notifyListeners();
  }

  Future<void> _invalidateNotification() async {
    final current = session;
    if (current == null) return;
    await ForegroundServiceBridge().update(
      title: 'Zero UI emergency active',
      text: '${current.emergencyId.substring(0, 8)}… · '
          '${current.location?.readable ?? 'awaiting GPS'} · '
          '${current.segmentsUploaded} audio segment(s)',
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // Android lifecycle
  // ══════════════════════════════════════════════════════════════════

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _lifecycle = state;
    if (state == AppLifecycleState.resumed) {
      _onResumed();
    }
    notifyListeners();
  }

  Future<void> _onResumed() async {
    // A returning app must not silently lose an active emergency: re-verify
    // with the backend, reconnect the socket and restart capture if the OS
    // stopped it while we were in the background.
    if (phase == AppPhase.active) {
      if (!deviceSocketConnected) _connectDeviceSocket();
      if (!recording) await _startAudioCapture();
      await ForegroundServiceBridge().isRunning();
      await outbox.flush();
      queuedItems = outbox.pending;
      notifyListeners();
      return;
    }
    if (phase == AppPhase.passive) {
      await outbox.flush();
      queuedItems = outbox.pending;
      try {
        await ensureEnrolled();
      } catch (_) {}
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _locationTimer?.cancel();
    _telemetryTimer?.cancel();
    _flushTimer?.cancel();
    _notificationTimer?.cancel();
    _reconnectTimer?.cancel();
    _socketSubscription?.cancel();
    _socket?.sink.close();
    fallDetector.dispose();
    _audio?.dispose();
    api.close();
    super.dispose();
  }
}
