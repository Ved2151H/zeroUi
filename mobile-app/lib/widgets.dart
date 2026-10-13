import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme/tokens.dart';

/// ---------------------------------------------------------------------------
/// The Zero UI component kit.
///
/// These are the mobile counterparts of the console's components: the same
/// panel, the same hairline border, the same status pill, the same press
/// feedback. Nothing here reaches for a Material default, and no widget in this
/// file may introduce a colour that is not in `theme/tokens.dart`.
///
/// Every tone in [ZeroTone] carries the same meaning it has on the dashboard:
/// danger is an active emergency, warning is cancelled or degraded, success is
/// safe or resolved, stale is inactive or unavailable.
/// ---------------------------------------------------------------------------

/// The status vocabulary shared with the authority dashboard.
enum ZeroTone {
  /// Champagne. Hierarchy, the active selection, the current mode.
  accent,

  /// Red. An active emergency, or a failure that matters.
  danger,

  /// Amber. Cancelled, degraded, waiting, needs attention.
  warning,

  /// Green. Safe, resolved, connected, healthy.
  success,

  /// Grey. Inactive, stale, unavailable, unknown.
  stale,

  /// Panel grey. Plain information with no state attached.
  neutral;

  Color get color => switch (this) {
        ZeroTone.accent => ZeroAccent.base,
        ZeroTone.danger => ZeroStatus.danger,
        ZeroTone.warning => ZeroStatus.warning,
        ZeroTone.success => ZeroStatus.success,
        ZeroTone.stale => ZeroStatus.stale,
        ZeroTone.neutral => ZeroSurface.text2,
      };

  Color get soft => switch (this) {
        ZeroTone.accent => ZeroAccent.soft,
        ZeroTone.danger => ZeroStatus.dangerSoft,
        ZeroTone.warning => ZeroStatus.warningSoft,
        ZeroTone.success => ZeroStatus.successSoft,
        ZeroTone.stale => ZeroStatus.staleSoft,
        ZeroTone.neutral => ZeroSurface.panel3,
      };

  Color get line => switch (this) {
        ZeroTone.accent => ZeroAccent.line,
        ZeroTone.danger => ZeroStatus.dangerLine,
        ZeroTone.warning => ZeroStatus.warningLine,
        ZeroTone.success => ZeroStatus.successLine,
        ZeroTone.stale => ZeroStatus.staleLine,
        ZeroTone.neutral => ZeroSurface.lineStrong,
      };

  /// The word the console uses for this tone. Kept here so the handset and the
  /// dashboard cannot label the same state differently.
  String get label => switch (this) {
        ZeroTone.accent => 'ACTIVE',
        ZeroTone.danger => 'ERROR',
        ZeroTone.warning => 'WARNING',
        ZeroTone.success => 'OK',
        ZeroTone.stale => 'STALE',
        ZeroTone.neutral => 'INFO',
      };
}

/// True when the operator has asked the system to remove animations.
///
/// This is the mobile equivalent of the console's `prefers-reduced-motion`
/// guard: state is never carried by motion alone, so honouring it costs
/// nothing but an animation.
bool zeroMotionDisabled(BuildContext context) =>
    MediaQuery.maybeOf(context)?.disableAnimations ?? false;

/// Press feedback, ported from the console's motion layer.
///
/// The dashboard answers a press in 90 ms with a 1 px drop and a sub-2 % scale;
/// this is the same gesture on a touch screen. There is no Material ripple:
/// `splashFactory` is disabled in the theme so this is the only press feedback
/// in the app.
class ZeroTappable extends StatefulWidget {
  const ZeroTappable({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.enabled = true,
    this.semanticLabel,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool enabled;
  final String? semanticLabel;

  @override
  State<ZeroTappable> createState() => _ZeroTappableState();
}

class _ZeroTappableState extends State<ZeroTappable> {
  bool _down = false;

  bool get _interactive => widget.enabled && (widget.onTap != null || widget.onLongPress != null);

  @override
  Widget build(BuildContext context) {
    final reduce = zeroMotionDisabled(context);
    final pressed = _down && _interactive && !reduce;
    final child = AnimatedScale(
      scale: pressed ? 0.985 : 1,
      duration: reduce ? Duration.zero : ZeroMotion.micro,
      curve: ZeroMotion.easeOut,
      child: widget.child,
    );

    return Semantics(
      label: widget.semanticLabel,
      button: widget.onTap != null,
      enabled: _interactive,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: _interactive ? (_) => setState(() => _down = true) : null,
        onTapUp: _interactive ? (_) => setState(() => _down = false) : null,
        onTapCancel: _interactive ? () => setState(() => _down = false) : null,
        onTap: _interactive ? widget.onTap : null,
        onLongPress: _interactive ? widget.onLongPress : null,
        child: Opacity(opacity: widget.enabled ? 1 : 0.45, child: child),
      ),
    );
  }
}

/// A graphite panel: the console's primary surface.
///
/// Mirrors the dashboard's `.panel` — `--panel` fill, one hairline border,
/// `--r-panel` corners, no shadow. Depth comes from the border, never from a
/// shadow or a tint.
class ZeroPanel extends StatelessWidget {
  const ZeroPanel({
    super.key,
    required this.child,
    this.title,
    this.trailing,
    this.tone,
    this.padding = const EdgeInsets.all(ZeroSpace.padPanel),
    this.emphasised = false,
  });

  final Widget child;
  final String? title;
  final Widget? trailing;

  /// When set, the panel takes the tone's soft fill and border — the same
  /// treatment the dashboard gives an active incident's row.
  final ZeroTone? tone;

  final EdgeInsets padding;

  /// A stronger border, used for the one panel that matters right now.
  final bool emphasised;

  @override
  Widget build(BuildContext context) {
    final tone = this.tone;
    final border = tone != null
        ? tone.line
        : (emphasised ? ZeroSurface.lineStrong : ZeroSurface.line);
    final fill = tone != null ? tone.soft : ZeroSurface.panel;

    return Container(
      decoration: BoxDecoration(
        color: fill,
        borderRadius: ZeroRadius.panelAll,
        border: Border.all(color: border, width: ZeroMetrics.hairline),
      ),
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (title != null) ...[
            Row(
              children: [
                Expanded(child: Text(title!.toUpperCase(), style: ZeroType.sectionLabel)),
                ?trailing,
              ],
            ),
            const SizedBox(height: ZeroSpace.s3),
          ],
          child,
        ],
      ),
    );
  }
}

/// An uppercase group label with the console's spacing below it.
class ZeroSectionLabel extends StatelessWidget {
  const ZeroSectionLabel(this.label, {super.key, this.trailing});

  final String label;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: ZeroSpace.s2),
      child: Row(
        children: [
          Expanded(child: Text(label.toUpperCase(), style: ZeroType.sectionLabel)),
          ?trailing,
        ],
      ),
    );
  }
}

/// A status dot. The console's `.live-dot`: a filled circle in the status hue.
///
/// [pulse] breathes exactly like the dashboard's live indicator — a slow
/// opacity cycle, never a scale bounce or a glow.
class ZeroStatusDot extends StatefulWidget {
  const ZeroStatusDot({
    super.key,
    required this.tone,
    this.size = ZeroMetrics.dot,
    this.pulse = false,
  });

  final ZeroTone tone;
  final double size;
  final bool pulse;

  @override
  State<ZeroStatusDot> createState() => _ZeroStatusDotState();
}

class _ZeroStatusDotState extends State<ZeroStatusDot> with SingleTickerProviderStateMixin {
  AnimationController? _controller;

  @override
  void initState() {
    super.initState();
    if (widget.pulse) _startPulse();
  }

  void _startPulse() {
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat(reverse: true);
  }

  @override
  void didUpdateWidget(ZeroStatusDot old) {
    super.didUpdateWidget(old);
    if (widget.pulse && _controller == null) {
      _startPulse();
    } else if (!widget.pulse && _controller != null) {
      _controller!.dispose();
      _controller = null;
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dot = Container(
      width: widget.size,
      height: widget.size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: widget.tone.color,
      ),
    );
    if (_controller == null || zeroMotionDisabled(context)) {
      return dot;
    }
    return FadeTransition(
      opacity: Tween<double>(begin: 0.35, end: 1).animate(
        CurvedAnimation(parent: _controller!, curve: ZeroMotion.easeInOut),
      ),
      child: dot,
    );
  }
}

/// The console's status pill.
///
/// Same shape as `.status-pill` on the dashboard: the tone's soft fill, a
/// hairline in the tone's line colour, and the tone's text colour. It carries
/// no shadow and no gradient, and it never blinks.
class StatusChip extends StatelessWidget {
  const StatusChip({
    super.key,
    required this.label,
    required this.tone,
    this.icon,
    this.dot = false,
    this.compact = false,
  });

  final String label;
  final ZeroTone tone;
  final IconData? icon;

  /// Show a leading status dot instead of an icon.
  final bool dot;

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? ZeroSpace.s2 : ZeroSpace.s3,
        vertical: compact ? 4 : 6,
      ),
      decoration: BoxDecoration(
        color: tone.soft,
        borderRadius: ZeroRadius.pillAll,
        border: Border.all(color: tone.line, width: ZeroMetrics.hairline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: compact ? 12 : 13, color: tone.color),
            const SizedBox(width: ZeroSpace.s1 + 1),
          ] else if (dot) ...[
            ZeroStatusDot(tone: tone, size: 6),
            const SizedBox(width: ZeroSpace.s2),
          ],
          Text(
            label.toUpperCase(),
            style: ZeroType.pill.copyWith(color: tone.color),
          ),
        ],
      ),
    );
  }
}

/// A label/value tile — the console's stat card, sized for a handset.
///
/// Values that an operator compares digit by digit pass `monospace: true` and
/// are set in IBM Plex Mono, exactly as the dashboard sets coordinates,
/// DIGIPINs and counts.
class InfoTile extends StatelessWidget {
  const InfoTile({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.tone,
    this.monospace = false,
    this.trailing,
    this.subvalue,
  });

  final String label;
  final String value;
  final IconData? icon;

  /// Colours the value and the label, for a state worth noticing.
  final ZeroTone? tone;

  final bool monospace;
  final Widget? trailing;
  final String? subvalue;

  @override
  Widget build(BuildContext context) {
    final tone = this.tone;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: ZeroSpace.s3,
        vertical: ZeroSpace.s3,
      ),
      decoration: BoxDecoration(
        color: tone?.soft ?? ZeroSurface.panel2,
        borderRadius: ZeroRadius.tileAll,
        border: Border.all(
          color: tone?.line ?? ZeroSurface.line,
          width: ZeroMetrics.hairline,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: tone?.color ?? ZeroSurface.text3),
            const SizedBox(width: ZeroSpace.s2),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(label.toUpperCase(), style: ZeroType.fieldLabel),
                const SizedBox(height: ZeroSpace.s1 + 1),
                Text(
                  value,
                  style: (monospace ? ZeroType.monoValue : ZeroType.value)
                      .copyWith(color: tone?.color),
                ),
                if (subvalue != null) ...[
                  const SizedBox(height: 2),
                  Text(subvalue!, style: ZeroType.monoCaption),
                ],
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// A single justified label/value row, used inside panels.
class ZeroRow extends StatelessWidget {
  const ZeroRow({
    super.key,
    required this.label,
    required this.value,
    this.tone,
    this.monospace = false,
    this.trailing,
    this.wrap = false,
  });

  final String label;
  final String value;
  final ZeroTone? tone;
  final bool monospace;
  final Widget? trailing;
  final bool wrap;

  @override
  Widget build(BuildContext context) {
    final valueStyle = (monospace ? ZeroType.monoValue : ZeroType.value)
        .copyWith(color: tone?.color ?? ZeroSurface.text);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: ZeroSpace.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: ZeroType.fieldLabel),
          const SizedBox(height: ZeroSpace.s1),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(value, style: valueStyle, softWrap: wrap),
              ),
              ?trailing,
            ],
          ),
        ],
      ),
    );
  }
}

/// The console's button language, as a widget.
///
/// `primary` is the champagne action, `danger` is the emergency action,
/// `success` is "I'm safe", and `ghost` is everything secondary. Every variant
/// shares the same shape, radius and press feedback.
enum ZeroButtonVariant { primary, danger, success, ghost }

class ZeroButton extends StatelessWidget {
  const ZeroButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = ZeroButtonVariant.primary,
    this.icon,
    this.busy = false,
    this.expanded = true,
    this.subtitle,
  });

  final String label;
  final VoidCallback? onPressed;
  final ZeroButtonVariant variant;
  final IconData? icon;
  final bool busy;
  final bool expanded;
  final String? subtitle;

  bool get _enabled => onPressed != null && !busy;

  @override
  Widget build(BuildContext context) {
    final (Color bg, Color fg, Color border) = switch (variant) {
      ZeroButtonVariant.primary => (
          ZeroAccent.base,
          ZeroAccent.ink,
          ZeroAccent.base,
        ),
      ZeroButtonVariant.danger => (
          ZeroStatus.dangerSoft,
          ZeroStatus.danger,
          ZeroStatus.dangerLine,
        ),
      ZeroButtonVariant.success => (
          ZeroStatus.successSoft,
          ZeroStatus.success,
          ZeroStatus.successLine,
        ),
      ZeroButtonVariant.ghost => (
          ZeroSurface.panel2,
          ZeroSurface.text,
          ZeroSurface.lineStrong,
        ),
    };

    final content = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: ZeroSpace.s4,
        vertical: ZeroSpace.s3 + 2,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (busy)
                SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation(fg),
                  ),
                )
              else if (icon != null)
                Icon(icon, size: 17, color: fg),
              if (busy || icon != null) const SizedBox(width: ZeroSpace.s2),
              Flexible(
                child: Text(
                  label.toUpperCase(),
                  style: ZeroType.button.copyWith(color: fg),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: ZeroSpace.s1),
            Text(
              subtitle!,
              style: ZeroType.monoCaption.copyWith(color: fg.withValues(alpha: 0.72)),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );

    final box = Container(
      decoration: BoxDecoration(
        color: _enabled ? bg : ZeroSurface.panel2,
        borderRadius: ZeroRadius.controlAll,
        border: Border.all(
          color: _enabled ? border : ZeroSurface.line,
          width: ZeroMetrics.hairline,
        ),
      ),
      constraints: const BoxConstraints(minHeight: ZeroMetrics.minTouch),
      child: Center(child: content),
    );

    final tappable = ZeroTappable(
      onTap: _enabled ? onPressed : null,
      enabled: _enabled,
      semanticLabel: label,
      child: box,
    );

    return expanded ? SizedBox(width: double.infinity, child: tappable) : tappable;
  }
}

/// A large, quiet header used at the top of every screen: an icon tile, the
/// mode name and one line of supporting state. Mirrors the dashboard's
/// dossier header.
class ZeroScreenHeader extends StatelessWidget {
  const ZeroScreenHeader({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.tone,
    this.trailing,
    this.eyebrow,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final ZeroTone tone;
  final Widget? trailing;
  final String? eyebrow;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (eyebrow != null) ...[
          Text(eyebrow!.toUpperCase(), style: ZeroType.sectionLabel),
          const SizedBox(height: ZeroSpace.s2),
        ],
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: ZeroMetrics.glyphTile,
              height: ZeroMetrics.glyphTile,
              decoration: BoxDecoration(
                color: tone.soft,
                borderRadius: ZeroRadius.tileAll,
                border: Border.all(color: tone.line, width: ZeroMetrics.hairline),
              ),
              child: Icon(icon, size: 18, color: tone.color),
            ),
            const SizedBox(width: ZeroSpace.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(title, style: ZeroType.screenTitle),
                  const SizedBox(height: 2),
                  Text(subtitle, style: ZeroType.bodyDim),
                ],
              ),
            ),
            ?trailing,
          ],
        ),
      ],
    );
  }
}

/// A one-line inline notice — the console's `.alarm` banner, no longer shouting.
class ZeroNotice extends StatelessWidget {
  const ZeroNotice({
    super.key,
    required this.message,
    this.tone = ZeroTone.warning,
    this.icon,
  });

  final String message;
  final ZeroTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: ZeroSpace.s3,
        vertical: ZeroSpace.s2 + 2,
      ),
      decoration: BoxDecoration(
        color: tone.soft,
        borderRadius: ZeroRadius.cardAll,
        border: Border.all(color: tone.line, width: ZeroMetrics.hairline),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon ?? Icons.info_outline, size: 15, color: tone.color),
          const SizedBox(width: ZeroSpace.s2),
          Expanded(
            child: Text(
              message,
              style: ZeroType.bodyDim.copyWith(color: tone.color, fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }
}

/// 4-digit safety PIN pad. Submits automatically once four digits are entered.
class PinPad extends StatefulWidget {
  const PinPad({
    super.key,
    required this.title,
    required this.subtitle,
    required this.onSubmit,
    this.error,
    this.busy = false,
    this.actionLabel = 'Confirm',
  });

  final String title;
  final String subtitle;
  final Future<void> Function(String pin) onSubmit;
  final String? error;
  final bool busy;
  final String actionLabel;

  @override
  State<PinPad> createState() => _PinPadState();
}

class _PinPadState extends State<PinPad> {
  String _entry = '';

  void _press(String digit) {
    if (widget.busy || _entry.length >= 4) return;
    HapticFeedback.selectionClick();
    setState(() => _entry += digit);
    if (_entry.length == 4) {
      final pin = _entry;
      Future<void>.delayed(const Duration(milliseconds: 120), () async {
        await widget.onSubmit(pin);
        if (mounted) setState(() => _entry = '');
      });
    }
  }

  void _backspace() {
    if (widget.busy || _entry.isEmpty) return;
    HapticFeedback.selectionClick();
    setState(() => _entry = _entry.substring(0, _entry.length - 1));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(widget.title, style: ZeroType.panelTitle, textAlign: TextAlign.center),
        const SizedBox(height: ZeroSpace.s1),
        Text(widget.subtitle, style: ZeroType.bodyDim, textAlign: TextAlign.center),
        const SizedBox(height: ZeroSpace.s5),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(4, (index) {
            final filled = index < _entry.length;
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: ZeroSpace.s2),
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: filled ? ZeroAccent.base : Colors.transparent,
                border: Border.all(
                  color: filled ? ZeroAccent.base : ZeroSurface.lineStrong,
                  width: 1.5,
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: ZeroSpace.s4),
        if (widget.error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: ZeroSpace.s2),
            child: Text(
              widget.error!,
              style: ZeroType.bodyDim.copyWith(color: ZeroStatus.danger),
              textAlign: TextAlign.center,
            ),
          ),
        SizedBox(
          width: 264,
          child: Column(
            children: [
              for (final row in const [
                ['1', '2', '3'],
                ['4', '5', '6'],
                ['7', '8', '9'],
              ])
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    for (final digit in row) _Key(label: digit, onTap: () => _press(digit)),
                  ],
                ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  const SizedBox(width: 70),
                  _Key(label: '0', onTap: () => _press('0')),
                  _Key(label: '⌫', onTap: _backspace),
                ],
              ),
            ],
          ),
        ),
        if (widget.busy) ...[
          const SizedBox(height: ZeroSpace.s4),
          const SizedBox(
            height: 16,
            width: 16,
            child: CircularProgressIndicator(strokeWidth: 2, color: ZeroAccent.base),
          ),
        ],
      ],
    );
  }
}

class _Key extends StatelessWidget {
  const _Key({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(ZeroSpace.s1 + 2),
      child: ZeroTappable(
        onTap: onTap,
        semanticLabel: label == '⌫' ? 'Backspace' : label,
        child: Container(
          width: 70,
          height: 70,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: ZeroSurface.panel2,
            border: Border.all(color: ZeroSurface.line, width: ZeroMetrics.hairline),
          ),
          child: Text(
            label,
            style: ZeroType.panelTitle.copyWith(fontSize: 21),
          ),
        ),
      ),
    );
  }
}

/// Vertical event timeline — the console's dossier timeline, on a handset.
class EventTimeline extends StatelessWidget {
  const EventTimeline({super.key, required this.events, this.maxEntries = 60});

  final List<Map<String, dynamic>> events;
  final int maxEntries;

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) {
      return Text('No events yet', style: ZeroType.bodyDim.copyWith(color: ZeroSurface.text3));
    }
    final visible = events.reversed.take(maxEntries).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final event in visible)
          Padding(
            padding: const EdgeInsets.only(bottom: ZeroSpace.s3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 5),
                  child: ZeroStatusDot(
                    tone: _eventTone(event['event_type'] as String? ?? ''),
                    size: 7,
                  ),
                ),
                const SizedBox(width: ZeroSpace.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        (event['description'] as String? ?? '').trim(),
                        style: ZeroType.body.copyWith(fontSize: 12.5),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${event['event_type']} · ${_clock(event['timestamp'] as String?)}',
                        style: ZeroType.monoCaption,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  static String _clock(String? iso) {
    if (iso == null) return '';
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return '';
    final local = parsed.toLocal();
    return '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}:'
        '${local.second.toString().padLeft(2, '0')}';
  }

  /// The same classification the dashboard applies to timeline entries.
  static ZeroTone _eventTone(String type) {
    if (RegExp(r'emergency|sos|fall|cancel|no_response|failed|unavailable')
        .hasMatch(type)) {
      return ZeroTone.danger;
    }
    if (RegExp(r'audio|mic|countdown|location|gps|digipin|live|queued|pending')
        .hasMatch(type)) {
      return ZeroTone.warning;
    }
    if (RegExp(r'resolved|safe|sms|connected|started|resumed').hasMatch(type)) {
      return ZeroTone.success;
    }
    return ZeroTone.stale;
  }
}

/// A coordinated entrance: children settle in over the console's `--t-med`,
/// staggered by a small offset so a panel reads as arriving rather than
/// appearing. Motion is skipped entirely when the system asks for reduced
/// motion.
class ZeroStagger extends StatelessWidget {
  const ZeroStagger({super.key, required this.children, this.step = 26});

  final List<Widget> children;
  final int step;

  @override
  Widget build(BuildContext context) {
    if (zeroMotionDisabled(context)) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++)
          _StaggerItem(index: i, step: step, child: children[i]),
      ],
    );
  }
}

class _StaggerItem extends StatefulWidget {
  const _StaggerItem({required this.index, required this.step, required this.child});

  final int index;
  final int step;
  final Widget child;

  @override
  State<_StaggerItem> createState() => _StaggerItemState();
}

class _StaggerItemState extends State<_StaggerItem> {
  bool _shown = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(Duration(milliseconds: widget.index * widget.step), () {
      if (mounted) setState(() => _shown = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      opacity: _shown ? 1 : 0,
      duration: ZeroMotion.med,
      curve: ZeroMotion.easeOut,
      child: AnimatedSlide(
        offset: _shown ? Offset.zero : const Offset(0, 0.04),
        duration: ZeroMotion.med,
        curve: ZeroMotion.easeOut,
        child: widget.child,
      ),
    );
  }
}
