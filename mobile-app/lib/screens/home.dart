import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../config.dart';
import '../emergency_controller.dart';
import '../hardware_trigger.dart';
import '../theme/tokens.dart';
import '../widgets.dart';
import 'settings.dart';

/// PASSIVE MODE.
///
/// The calm half of the product. This screen has one job: make it obvious that
/// the device is watching, and honest about exactly which capabilities are
/// available. It must read as an instrument that is on — not a blank consumer
/// app and not an alarm.
///
/// The order of the panels follows the operator's priorities: current mode,
/// what is being watched, where the phone is, whether audio is possible, and
/// whether the authority can be reached.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller});

  final EmergencyController controller;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _locationOn = false;
  String _permissionSummary = 'checking…';
  Map<String, dynamic> _gesture = const {};

  @override
  void initState() {
    super.initState();
    _refreshStatus();
  }

  Future<void> _refreshStatus() async {
    var serviceOn = false;
    var summary = 'unknown';
    try {
      serviceOn = await Geolocator.isLocationServiceEnabled();
      final permission = await Geolocator.checkPermission();
      summary = switch (permission) {
        LocationPermission.always => 'always',
        LocationPermission.whileInUse => 'while in use',
        LocationPermission.denied => 'denied',
        LocationPermission.deniedForever => 'blocked in settings',
        _ => permission.name,
      };
    } catch (_) {}
    final gesture = await HardwareTriggerBridge.gesture();
    if (mounted) {
      setState(() {
        _locationOn = serviceOn;
        _permissionSummary = summary;
        _gesture = gesture;
      });
    }
  }

  Future<void> _refreshAll() async {
    await widget.controller.refreshCapabilities();
    await _refreshStatus();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final connection = _connection(controller);

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: ZeroAccent.base,
          backgroundColor: ZeroSurface.panel,
          onRefresh: _refreshAll,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              ZeroSpace.gutter,
              ZeroSpace.s4,
              ZeroSpace.gutter,
              ZeroSpace.s6,
            ),
            children: [
              ZeroStagger(
                children: [
                  ZeroScreenHeader(
                    eyebrow: 'Zero UI · Emergency device',
                    title: 'Passive monitoring',
                    subtitle: controller.monitoringServiceRunning
                        ? 'Watching sensors in the background'
                        : 'Watching sensors while the app is open',
                    icon: Icons.shield_outlined,
                    tone: controller.monitoringServiceRunning
                        ? ZeroTone.success
                        : ZeroTone.warning,
                    trailing: ZeroTappable(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => SettingsScreen(controller: controller),
                        ),
                      ),
                      semanticLabel: 'Settings',
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: ZeroSurface.panel2,
                          borderRadius: ZeroRadius.controlAll,
                          border: Border.all(
                            color: ZeroSurface.line,
                            width: ZeroMetrics.hairline,
                          ),
                        ),
                        child: const Icon(Icons.tune, size: 17, color: ZeroSurface.text2),
                      ),
                    ),
                  ),
                  const SizedBox(height: ZeroSpace.s4),

                  // ── state strip ──
                  Wrap(
                    spacing: ZeroSpace.s2,
                    runSpacing: ZeroSpace.s2,
                    children: [
                      StatusChip(
                        label: controller.monitoringServiceRunning
                            ? 'Monitoring'
                            : 'Foreground only',
                        tone: controller.monitoringServiceRunning
                            ? ZeroTone.success
                            : ZeroTone.warning,
                        dot: true,
                      ),
                      StatusChip(
                        label: connection.$1,
                        tone: connection.$2,
                        dot: true,
                      ),
                      StatusChip(
                        label: controller.accelerometerAvailable
                            ? 'Detection armed'
                            : 'No accelerometer',
                        tone: controller.accelerometerAvailable
                            ? ZeroTone.accent
                            : ZeroTone.danger,
                        dot: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: ZeroSpace.s5),

                  // ── manual activation ──
                  ZeroButton(
                    label: 'Send SOS now',
                    subtitle: 'Runs the verification window first',
                    icon: Icons.sos,
                    variant: ZeroButtonVariant.danger,
                    onPressed:
                        controller.phase == AppPhase.passive ? controller.triggerManualSos : null,
                  ),
                  const SizedBox(height: ZeroSpace.s3),
                  const ZeroNotice(
                    message:
                        'A sensor or manual detection opens a verification window before '
                        'anything is sent, so a false alarm can be cancelled. The hardware '
                        'gesture below activates immediately.',
                    tone: ZeroTone.stale,
                    icon: Icons.info_outline,
                  ),

                  const SizedBox(height: ZeroSpace.s5),

                  // ── detection ──
                  _panel(
                    'Detection',
                    trailing: StatusChip(
                      compact: true,
                      label: controller.accelerometerAvailable ? 'Armed' : 'Offline',
                      tone: controller.accelerometerAvailable
                          ? ZeroTone.success
                          : ZeroTone.danger,
                    ),
                    children: [
                      ZeroRow(
                        label: 'Accelerometer',
                        value: controller.accelerometerAvailable
                            ? '${controller.accelerometerMagnitude.toStringAsFixed(2)} m/s²'
                            : 'unavailable',
                        monospace: true,
                        tone: controller.accelerometerAvailable ? null : ZeroTone.danger,
                      ),
                      ZeroRow(
                        label: 'Motion now',
                        value: controller.accelerometerMagnitude > 2.5 ? 'moving' : 'still',
                      ),
                      ZeroRow(
                        label: 'Fall algorithm',
                        value:
                            'free-fall → impact → stillness',
                        wrap: true,
                      ),
                      ZeroRow(
                        label: 'Thresholds',
                        value:
                            '< ${_detection(controller).freeFallThreshold.toStringAsFixed(1)} m/s² fall · '
                            '> ${_detection(controller).impactThreshold.toStringAsFixed(0)} m/s² impact · '
                            '${_detection(controller).inactivitySeconds.toStringAsFixed(1)} s still',
                        monospace: true,
                        wrap: true,
                      ),
                      const ZeroRow(
                        label: 'Gyroscope',
                        value: 'not used — the detector is accelerometer-only',
                        tone: ZeroTone.stale,
                        wrap: true,
                      ),
                    ],
                  ),

                  const SizedBox(height: ZeroSpace.s4),

                  // ── location ──
                  _panel(
                    'Location',
                    children: [
                      ZeroRow(
                        label: 'GPS service',
                        value: _locationOn ? 'enabled' : 'off',
                        tone: _locationOn ? ZeroTone.success : ZeroTone.danger,
                      ),
                      ZeroRow(
                        label: 'Permission',
                        value: _permissionSummary,
                        tone: _permissionSummary == 'always' ? ZeroTone.success : null,
                      ),
                      ZeroRow(
                        label: 'Last DIGIPIN',
                        value: controller.lastDigipin ?? 'none yet',
                        monospace: true,
                        tone: controller.lastDigipin == null ? ZeroTone.stale : ZeroTone.accent,
                      ),
                      const ZeroRow(
                        label: 'Source',
                        value: 'device GPS — never a simulated position',
                        tone: ZeroTone.stale,
                        wrap: true,
                      ),
                    ],
                  ),

                  const SizedBox(height: ZeroSpace.s4),

                  // ── audio ──
                  _panel(
                    'Microphone',
                    children: [
                      ZeroRow(
                        label: 'Permission',
                        value: controller.microphoneGranted ? 'granted' : 'not granted',
                        tone:
                            controller.microphoneGranted ? ZeroTone.success : ZeroTone.danger,
                      ),
                      ZeroRow(
                        label: 'Capture',
                        value: controller.recording ? 'recording' : 'idle',
                        tone: controller.recording ? ZeroTone.danger : ZeroTone.stale,
                      ),
                      const ZeroRow(
                        label: 'Opens',
                        value:
                            'only during a verification window or an active emergency — '
                            'never while monitoring',
                        tone: ZeroTone.stale,
                        wrap: true,
                      ),
                    ],
                  ),

                  const SizedBox(height: ZeroSpace.s4),

                  // ── connection ──
                  _panel(
                    'Command centre',
                    children: [
                      ZeroRow(
                        label: 'Backend',
                        value: controller.backendReachable ? 'reachable' : 'unreachable',
                        tone: controller.backendReachable ? ZeroTone.success : ZeroTone.danger,
                      ),
                      ZeroRow(
                        label: 'Queued for retry',
                        value: '${controller.queuedItems}',
                        monospace: true,
                        tone: controller.queuedItems > 0 ? ZeroTone.warning : null,
                      ),
                      ZeroRow(
                        label: 'Device',
                        value: controller.api.identity?.deviceId.substring(0, 12) ?? 'not enrolled',
                        monospace: true,
                      ),
                      ZeroRow(
                        label: 'Server',
                        value: controller.store.apiBase,
                        monospace: true,
                      ),
                    ],
                  ),

                  const SizedBox(height: ZeroSpace.s4),

                  // ── hardware trigger ──
                  _panel(
                    'Emergency button',
                    trailing: StatusChip(
                      compact: true,
                      label: controller.hardwareTriggerArmed ? 'Armed' : 'Inactive',
                      tone: controller.hardwareTriggerArmed ? ZeroTone.success : ZeroTone.stale,
                    ),
                    children: [
                      Text(
                        _gestureText(_gesture),
                        style: ZeroType.value.copyWith(color: ZeroTone.accent.color),
                      ),
                      const SizedBox(height: ZeroSpace.s2),
                      ZeroRow(
                        label: 'Verification window',
                        value: 'none — activates immediately',
                        tone: ZeroTone.danger,
                      ),
                      const ZeroRow(
                        label: 'Works when',
                        value:
                            'screen locked or app closed, while the monitoring service runs',
                        tone: ZeroTone.stale,
                        wrap: true,
                      ),
                      const ZeroNotice(
                        message:
                            'Android does not give applications access to the physical power '
                            'button, so the three-press gesture is bound to volume-down. It is '
                            'counted natively, so it still works with the screen off.',
                        tone: ZeroTone.stale,
                        icon: Icons.report_outlined,
                      ),
                    ],
                  ),

                  if (controller.store.devMode) ...[
                    const SizedBox(height: ZeroSpace.s4),
                    _panel(
                      'Developer',
                      children: [
                        ZeroButton(
                          label: 'Inject simulated drop',
                          subtitle: 'Runs the real detector, then the real window',
                          variant: ZeroButtonVariant.ghost,
                          icon: Icons.science_outlined,
                          onPressed: controller.simulateDrop,
                        ),
                        const SizedBox(height: ZeroSpace.s3),
                        ZeroButton(
                          label: 'Fire hardware trigger',
                          subtitle: 'Same path as the physical gesture',
                          variant: ZeroButtonVariant.ghost,
                          icon: Icons.bolt_outlined,
                          onPressed: () async {
                            final ok = await HardwareTriggerBridge.simulate();
                            if (!ok && context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Trigger rejected by the native service'),
                                ),
                              );
                            }
                          },
                        ),
                      ],
                    ),
                  ],

                  if (controller.store.lastReport != null) ...[
                    const SizedBox(height: ZeroSpace.s4),
                    ZeroPanel(
                      title: 'Last emergency',
                      child: Text(controller.store.lastReport!, style: ZeroType.bodyDim),
                    ),
                  ],

                  if (controller.notice != null) ...[
                    const SizedBox(height: ZeroSpace.s4),
                    ZeroNotice(
                      message: controller.notice!,
                      tone: ZeroTone.success,
                      icon: Icons.check_circle_outline,
                    ),
                  ],

                  if (controller.lastError != null) ...[
                    const SizedBox(height: ZeroSpace.s4),
                    ZeroNotice(
                      message: controller.lastError!,
                      tone: ZeroTone.danger,
                      icon: Icons.error_outline,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  static DetectionSettings _detection(EmergencyController controller) =>
      controller.store.detection;

  /// The gesture as the native service actually implements it.
  static String _gestureText(Map<String, dynamic> gesture) {
    final presses = gesture['presses'] as int? ?? 3;
    final windowMs = (gesture['windowMs'] as num?)?.toDouble() ?? 1500;
    return '$presses × volume-down within ${(windowMs / 1000).toStringAsFixed(1)} s';
  }

  /// The four connection words the specification asks for, derived from real
  /// state rather than a timer.
  static (String, ZeroTone) _connection(EmergencyController controller) {
    if (controller.queuedItems > 0 && controller.backendReachable) {
      return ('Syncing', ZeroTone.warning);
    }
    if (controller.backendReachable) return ('Connected', ZeroTone.success);
    return ('Offline', ZeroTone.danger);
  }

  Widget _panel(String title, {required List<Widget> children, Widget? trailing}) =>
      ZeroPanel(
        title: title,
        trailing: trailing,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: children,
        ),
      );
}
