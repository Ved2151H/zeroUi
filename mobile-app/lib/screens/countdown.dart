import 'package:flutter/material.dart';

import '../emergency_controller.dart';
import '../theme/tokens.dart';
import '../widgets.dart';

/// The verification window.
///
/// A sensor thought something happened. This screen asks the only question that
/// matters — *are you really in danger?* — and gives ten seconds to answer.
///
/// Design constraints taken from the console rather than from consumer safety
/// apps: no flashing screen, no red flood, no siren. The emphasis is a single
/// hairline ring in the danger red and one large numeral, which is enough to be
/// unmistakable while staying calm enough for a person who has just fallen.
///
/// Nothing has reached the authority at this point. If the window expires the
/// emergency is created; if the button is pressed it never exists at all.
class CountdownScreen extends StatelessWidget {
  const CountdownScreen({super.key, required this.controller});

  final EmergencyController controller;

  @override
  Widget build(BuildContext context) {
    final total = controller.countdownTotal.inSeconds.clamp(1, 600);
    final remaining = controller.countdownRemaining.clamp(0, total);
    final progress = 1 - (remaining / total);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            ZeroSpace.gutter,
            ZeroSpace.s5,
            ZeroSpace.gutter,
            ZeroSpace.s5,
          ),
          child: Column(
            children: [
              // ── what happened ──
              const StatusChip(
                label: 'Possible emergency detected',
                tone: ZeroTone.danger,
                icon: Icons.warning_amber_rounded,
              ),
              const SizedBox(height: ZeroSpace.s5),
              const Text('Are you really in danger?', style: ZeroType.screenTitle),
              const SizedBox(height: ZeroSpace.s2),
              Text(
                "Press I'M SAFE to cancel. If nothing is pressed, help is called "
                'automatically.',
                style: ZeroType.bodyDim,
                textAlign: TextAlign.center,
              ),

              // ── the count ──
              Expanded(
                child: Center(
                  child: _CountRing(progress: progress, remaining: remaining),
                ),
              ),

              if (controller.lastDetectionSummary != null) ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: ZeroSpace.s4),
                  child: Text(
                    controller.lastDetectionSummary!,
                    textAlign: TextAlign.center,
                    style: ZeroType.monoCaption,
                  ),
                ),
              ],

              // ── the one action ──
              ZeroButton(
                label: "I'm safe",
                subtitle: 'Cancels — nothing is sent',
                icon: Icons.check_circle_outline,
                variant: ZeroButtonVariant.success,
                onPressed: controller.confirmSafe,
              ),
              const SizedBox(height: ZeroSpace.s3),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const ZeroStatusDot(tone: ZeroTone.stale, size: 6),
                  const SizedBox(width: ZeroSpace.s2),
                  Text(
                    'Nothing has reached the authority dashboard yet',
                    style: ZeroType.monoCaption,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A single hairline ring that empties over the window, with the numeral inside.
///
/// The sweep is tweened between the controller's one-second ticks, so it moves
/// continuously rather than stepping — but there is no pulse, no glow and no
/// scale animation. The only thing that moves is the one thing being measured.
class _CountRing extends StatelessWidget {
  const _CountRing({required this.progress, required this.remaining});

  final double progress;
  final int remaining;

  @override
  Widget build(BuildContext context) {
    final reduce = zeroMotionDisabled(context);
    return SizedBox(
      width: 244,
      height: 244,
      child: Stack(
        alignment: Alignment.center,
        children: [
          TweenAnimationBuilder<double>(
            tween: Tween<double>(end: progress.clamp(0, 1)),
            duration: reduce ? Duration.zero : const Duration(seconds: 1),
            curve: Curves.linear,
            builder: (context, value, _) => SizedBox(
              width: 244,
              height: 244,
              child: CircularProgressIndicator(
                value: value,
                strokeWidth: 10,
                backgroundColor: ZeroSurface.panel3,
                valueColor: const AlwaysStoppedAnimation(ZeroStatus.danger),
                strokeCap: StrokeCap.round,
              ),
            ),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('$remaining', style: ZeroType.countdown),
              const SizedBox(height: ZeroSpace.s1),
              Text(
                remaining == 1 ? 'second remaining' : 'seconds remaining',
                style: ZeroType.sectionLabel,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
