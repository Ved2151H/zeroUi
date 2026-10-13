import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../emergency_controller.dart';
import '../models.dart';
import '../theme/tokens.dart';
import '../widgets.dart';

/// ACTIVE MODE.
///
/// The handset's half of a live incident. Everything the authority can see on
/// the console is represented here in the same language: the state, the real
/// coordinates, the DIGIPIN the backend issued, whether the microphone is
/// actually capturing, and whether the phone can still reach the command
/// centre.
///
/// The red is the console's `--danger`, used as an accent on a graphite field
/// rather than as a full-screen wash: this is an instrument reporting an
/// emergency, not an alarm clock.
class ActiveEmergencyScreen extends StatefulWidget {
  const ActiveEmergencyScreen({super.key, required this.controller});

  final EmergencyController controller;

  @override
  State<ActiveEmergencyScreen> createState() => _ActiveEmergencyScreenState();
}

class _ActiveEmergencyScreenState extends State<ActiveEmergencyScreen> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _confirmResolve() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('End this emergency?'),
        content: const Text(
          'The authority dashboard will mark this emergency as resolved. '
          'Audio and location tracking stop immediately.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep active'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('End emergency'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await widget.controller.resolveEmergency(note: 'Ended from the phone');
    }
  }

  Future<void> _openCancelSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) {
          String? error;
          bool busy = false;
          return Padding(
            padding: EdgeInsets.only(
              left: ZeroSpace.s5,
              right: ZeroSpace.s5,
              top: ZeroSpace.s5,
              bottom: MediaQuery.of(context).viewInsets.bottom + ZeroSpace.s5,
            ),
            child: PinPad(
              title: 'Cancel this emergency',
              subtitle: 'The PIN proves the person who started it is safe. The '
                  'dashboard will show it as cancelled, not resolved.',
              error: error,
              busy: busy,
              onSubmit: (pin) async {
                setSheetState(() {
                  busy = true;
                  error = null;
                });
                final ok = await widget.controller.cancelActiveEmergency(pin);
                if (!context.mounted) return;
                if (ok) {
                  Navigator.of(context).pop();
                } else {
                  setSheetState(() {
                    busy = false;
                    error = 'Incorrect PIN — the emergency stays active';
                  });
                }
              },
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final session = controller.session;
    if (session == null) return const SizedBox.shrink();
    if (session.resolved) {
      return _RecoveryView(controller: controller, session: session);
    }

    final elapsed = session.elapsed;
    final elapsedText = '${elapsed.inMinutes.toString().padLeft(2, '0')}:'
        '${(elapsed.inSeconds % 60).toString().padLeft(2, '0')}';
    final location = session.location;
    final connected = session.realtimeConnected;
    final pendingId = session.emergencyId.startsWith('pending-');

    return Scaffold(
      body: SafeArea(
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
                // ── state ──
                ZeroScreenHeader(
                  eyebrow: 'Active emergency',
                  title: elapsedText,
                  subtitle: triggerLabel(session.triggerType),
                  icon: Icons.emergency_outlined,
                  tone: ZeroTone.danger,
                  trailing: StatusChip(
                    label: pendingId ? 'Queued' : 'Live',
                    tone: pendingId ? ZeroTone.warning : ZeroTone.danger,
                    dot: true,
                  ),
                ),
                const SizedBox(height: ZeroSpace.s4),

                Wrap(
                  spacing: ZeroSpace.s2,
                  runSpacing: ZeroSpace.s2,
                  children: [
                    StatusChip(
                      label: connected ? 'Connected' : 'Reconnecting',
                      tone: connected ? ZeroTone.success : ZeroTone.warning,
                      dot: !connected,
                    ),
                    StatusChip(
                      label: controller.recording ? 'Recording' : 'Audio off',
                      tone: controller.recording ? ZeroTone.danger : ZeroTone.stale,
                      icon: controller.recording ? Icons.mic : Icons.mic_off,
                    ),
                    StatusChip(
                      label: location == null ? 'No GPS' : 'GPS fix',
                      tone: location == null ? ZeroTone.warning : ZeroTone.success,
                      dot: true,
                    ),
                  ],
                ),
                const SizedBox(height: ZeroSpace.s5),

                // ── the two things an operator reads aloud ──
                ZeroPanel(
                  tone: ZeroTone.danger,
                  title: 'Position',
                  trailing: ZeroStatusDot(
                    tone: location == null ? ZeroTone.warning : ZeroTone.success,
                    size: 7,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('DIGIPIN', style: ZeroType.fieldLabel),
                      const SizedBox(height: ZeroSpace.s1),
                      Text(
                        session.digipin ??
                            (session.digipinAvailable
                                ? 'pending from server'
                                : 'outside India coverage'),
                        style: ZeroType.monoValue.copyWith(
                          fontSize: 20,
                          color: session.digipin != null
                              ? ZeroAccent.base
                              : ZeroSurface.text3,
                        ),
                      ),
                      const SizedBox(height: ZeroSpace.s3),
                      Text('LATITUDE / LONGITUDE', style: ZeroType.fieldLabel),
                      const SizedBox(height: ZeroSpace.s1),
                      Text(
                        location == null
                            ? 'waiting for the device GPS'
                            : '${location.latitude.toStringAsFixed(6)}, '
                                '${location.longitude.toStringAsFixed(6)}',
                        style: ZeroType.monoValue.copyWith(fontSize: 13.5),
                      ),
                      const SizedBox(height: ZeroSpace.s3),
                      Row(
                        children: [
                          Expanded(
                            child: _mini(
                              'Accuracy',
                              location?.accuracy == null
                                  ? '—'
                                  : '±${location!.accuracy!.round()} m',
                            ),
                          ),
                          Expanded(
                            child: _mini(
                              'Updates',
                              'every ${controller.serverConfig.locationIntervalSeconds}s',
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: ZeroSpace.s4),

                // ── identity ──
                ZeroPanel(
                  title: 'Incident',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ZeroRow(
                        label: 'Emergency id',
                        value: session.emergencyId,
                        monospace: true,
                        wrap: true,
                        trailing: ZeroTappable(
                          onTap: () async {
                            await Clipboard.setData(
                              ClipboardData(text: session.emergencyId),
                            );
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('Emergency id copied')),
                              );
                            }
                          },
                          semanticLabel: 'Copy emergency id',
                          child: const Padding(
                            padding: EdgeInsets.only(left: ZeroSpace.s2),
                            child: Icon(Icons.copy, size: 15, color: ZeroSurface.text3),
                          ),
                        ),
                      ),
                      ZeroRow(
                        label: 'Trigger',
                        value: triggerLabel(session.triggerType),
                        tone: session.triggerType == 'hardware' ? ZeroTone.accent : null,
                      ),
                      ZeroRow(
                        label: 'Started',
                        value: _clock(session.startedAt),
                        monospace: true,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: ZeroSpace.s4),

                // ── audio ──
                ZeroPanel(
                  title: 'Audio',
                  trailing: StatusChip(
                    compact: true,
                    label: controller.recording ? 'Capturing' : 'Not recording',
                    tone: controller.recording ? ZeroTone.danger : ZeroTone.stale,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ZeroRow(
                        label: 'Segments stored',
                        value: '${session.segmentsUploaded}',
                        monospace: true,
                      ),
                      ZeroRow(
                        label: 'First segment',
                        value: '15 s, then the server segment length',
                        tone: ZeroTone.stale,
                        wrap: true,
                      ),
                      if (controller.queuedItems > 0)
                        ZeroRow(
                          label: 'Waiting to upload',
                          value: '${controller.queuedItems} item(s)',
                          tone: ZeroTone.warning,
                          monospace: true,
                        ),
                      const SizedBox(height: ZeroSpace.s2),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        value: controller.liveAudioEnabled,
                        onChanged: controller.setLiveAudioEnabled,
                        title: Text('Stream live audio', style: ZeroType.value),
                        subtitle: Text(
                          'Segments are always recorded. Live streaming sends the same '
                          'microphone stream in near real-time, and stops if Android '
                          'suspends the microphone.',
                          style: ZeroType.monoCaption,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: ZeroSpace.s4),

                // ── delivery ──
                ZeroPanel(
                  title: 'Delivery to command centre',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ZeroRow(
                        label: 'Realtime channel',
                        value: connected ? 'open' : 'reconnecting',
                        tone: connected ? ZeroTone.success : ZeroTone.warning,
                      ),
                      ZeroRow(
                        label: 'Foreground service',
                        value: controller.recording ? 'running' : 'starting',
                      ),
                      ZeroRow(
                        label: 'Last sync',
                        value: session.lastSyncAt == null
                            ? 'not yet'
                            : _clock(session.lastSyncAt!),
                        monospace: true,
                      ),
                      if (pendingId)
                        const ZeroNotice(
                          message:
                              'This emergency has not reached the backend yet. It is queued '
                              'and will be delivered with its id preserved as soon as the '
                              'connection returns.',
                          tone: ZeroTone.warning,
                          icon: Icons.cloud_off_outlined,
                        ),
                    ],
                  ),
                ),

                if (controller.lastError != null) ...[
                  const SizedBox(height: ZeroSpace.s4),
                  ZeroNotice(
                    message: controller.lastError!,
                    tone: ZeroTone.danger,
                    icon: Icons.error_outline,
                  ),
                ],

                const SizedBox(height: ZeroSpace.s4),

                ZeroPanel(
                  title: 'Event timeline',
                  child: EventTimeline(
                    events: controller.events.map((event) => event.toJson()).toList(),
                    maxEntries: 40,
                  ),
                ),
                const SizedBox(height: ZeroSpace.s5),

                // ── the two ways out ──
                ZeroButton(
                  label: 'End emergency',
                  subtitle: 'Resolved — tracking stops now',
                  icon: Icons.check_circle_outline,
                  variant: ZeroButtonVariant.success,
                  onPressed: _confirmResolve,
                ),
                const SizedBox(height: ZeroSpace.s3),
                ZeroButton(
                  label: 'Cancel false alarm',
                  subtitle: 'Requires your safety PIN',
                  icon: Icons.lock_outline,
                  variant: ZeroButtonVariant.ghost,
                  onPressed: _openCancelSheet,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _mini(String label, String value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: ZeroType.fieldLabel),
          const SizedBox(height: 2),
          Text(value, style: ZeroType.monoValue),
        ],
      );

  static String _clock(DateTime time) {
    final local = time.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')} '
        '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}:'
        '${local.second.toString().padLeft(2, '0')}';
  }
}

/// Shown after the emergency ends, from either side.
class _RecoveryView extends StatelessWidget {
  const _RecoveryView({required this.controller, required this.session});

  final EmergencyController controller;
  final EmergencySession session;

  @override
  Widget build(BuildContext context) {
    final cancelled = session.status == 'cancelled';
    final tone = cancelled ? ZeroTone.warning : ZeroTone.success;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            ZeroSpace.gutter,
            ZeroSpace.s5,
            ZeroSpace.gutter,
            ZeroSpace.s5,
          ),
          children: [
            ZeroScreenHeader(
              eyebrow: 'Session closed',
              title: cancelled ? 'Emergency cancelled' : 'Emergency resolved',
              subtitle: cancelled
                  ? 'You confirmed you were safe'
                  : 'Location and audio tracking have stopped',
              icon: cancelled ? Icons.cancel_outlined : Icons.verified_outlined,
              tone: tone,
            ),
            const SizedBox(height: ZeroSpace.s5),
            ZeroPanel(
              title: 'Summary',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ZeroRow(
                    label: 'Emergency id',
                    value: session.emergencyId,
                    monospace: true,
                    wrap: true,
                  ),
                  ZeroRow(label: 'Trigger', value: triggerLabel(session.triggerType)),
                  ZeroRow(
                    label: 'Duration',
                    value:
                        '${session.elapsed.inMinutes} min ${session.elapsed.inSeconds % 60} s',
                    monospace: true,
                  ),
                  ZeroRow(
                    label: 'Audio segments',
                    value: '${session.segmentsUploaded}',
                    monospace: true,
                  ),
                  ZeroRow(
                    label: 'Final position',
                    value: session.location?.readable ?? 'unknown',
                    monospace: true,
                    wrap: true,
                  ),
                  ZeroRow(
                    label: 'DIGIPIN',
                    value: session.digipin ?? 'not available',
                    monospace: true,
                    tone: session.digipin != null ? ZeroTone.accent : ZeroTone.stale,
                  ),
                ],
              ),
            ),
            const SizedBox(height: ZeroSpace.s4),
            ZeroNotice(
              message: cancelled
                  ? 'The authority dashboard shows this event as cancelled, not as a '
                      'resolved emergency.'
                  : 'This emergency is closed and visible as resolved on the authority '
                      'dashboard.',
              tone: tone,
              icon: cancelled ? Icons.info_outline : Icons.check_circle_outline,
            ),
            const SizedBox(height: ZeroSpace.s5),
            ZeroButton(
              label: 'Back to monitoring',
              icon: Icons.shield_outlined,
              onPressed: controller.dismissRecovery,
            ),
          ],
        ),
      ),
    );
  }
}

/// Trigger names, worded identically to the authority dashboard's
/// `TRIGGER_LABEL` map so the two screens cannot describe the same incident
/// differently.
String triggerLabel(String type) => switch (type) {
      'fall' => 'Fall detected',
      'manual' => 'Manual SOS',
      'shake' => 'Shake SOS',
      'hardware' => 'Hardware button',
      'test' => 'Test trigger',
      _ => type.isEmpty ? 'Unknown' : type,
    };
