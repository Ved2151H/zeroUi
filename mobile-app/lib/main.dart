import 'dart:async';
import 'package:flutter/material.dart';

import 'config.dart';
import 'emergency_controller.dart';
import 'foreground.dart';
import 'hardware_trigger.dart';
import 'screens/active.dart';
import 'screens/countdown.dart';
import 'screens/home.dart';
import 'screens/onboarding.dart';
import 'theme/tokens.dart';
import 'theme/zero_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await SessionStore.instance();
  final permissions = PermissionService();
  final controller = EmergencyController(store: store, permissions: permissions);
  WidgetsBinding.instance.addObserver(controller);

  // The three-press gesture is counted by the native foreground service, so it
  // arrives here even when no screen is open. It deliberately skips the
  // verification window: a deliberate gesture is already a confirmation.
  HardwareTriggerBridge.listen((presses) {
    unawaited(controller.triggerImmediateEmergency(
      triggerType: 'hardware',
      metadata: {'presses': presses},
    ));
  });

  runApp(ZeroUiApp(controller: controller));
  // Initialise after the first frame so the splash is visible while the app
  // restores identity, recovers an in-flight emergency and starts sensors.
  WidgetsBinding.instance.addPostFrameCallback((_) => controller.initialize());
}

/// Local convenience so [main] can dispatch a trigger without awaiting it.
void unawaited(Future<void> future) {
  future.catchError((Object error, StackTrace stack) {
    // A trigger that fails must never take the app down with it.
    debugPrint('Zero UI: background action failed: $error');
  });
}

class ZeroUiApp extends StatelessWidget {
  const ZeroUiApp({super.key, required this.controller});

  final EmergencyController controller;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Zero UI',
      debugShowCheckedModeBanner: false,
      theme: buildZeroTheme(),
      home: ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          switch (controller.phase) {
            case AppPhase.booting:
              return _Splash(controller: controller);
            case AppPhase.onboarding:
              return OnboardingScreen(controller: controller);
            case AppPhase.passive:
              return HomeScreen(controller: controller);
            case AppPhase.countdown:
              return CountdownScreen(controller: controller);
            case AppPhase.active:
            case AppPhase.recovered:
              return ActiveEmergencyScreen(controller: controller);
          }
        },
      ),
    );
  }
}

/// The screen shown while booting. If initialization takes longer than 4 seconds
/// (e.g. unreachable server or slow device sensor), it shows helpful troubleshooting
/// and a direct button to continue to setup so the user is never stuck.
class _Splash extends StatefulWidget {
  const _Splash({required this.controller});

  final EmergencyController controller;

  @override
  State<_Splash> createState() => _SplashState();
}

class _SplashState extends State<_Splash> {
  bool _showTroubleshooting = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(const Duration(seconds: 4), () {
      if (mounted) {
        setState(() => _showTroubleshooting = true);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const _Lockup(),
              const SizedBox(height: ZeroSpace.s6),
              const SizedBox(
                height: 22,
                width: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: ZeroAccent.base,
                ),
              ),
              if (_showTroubleshooting) ...[
                const SizedBox(height: ZeroSpace.s6),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: ZeroSurface.panel,
                    borderRadius: ZeroRadius.cardAll,
                    border: Border.all(color: ZeroSurface.border),
                  ),
                  child: Column(
                    children: [
                      Text(
                        widget.controller.lastError ?? 'Connecting to Zero UI system...',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13, color: ZeroSurface.text2),
                      ),
                      const SizedBox(height: ZeroSpace.s4),
                      FilledButton.icon(
                        onPressed: () {
                          widget.controller.phase = AppPhase.onboarding;
                          widget.controller.notifyListeners();
                        },
                        icon: const Icon(Icons.arrow_forward, size: 16),
                        label: const Text('Continue to Setup'),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Lockup extends StatelessWidget {
  const _Lockup();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 54,
          height: 54,
          decoration: BoxDecoration(
            color: ZeroAccent.soft,
            borderRadius: ZeroRadius.panelAll,
            border: Border.all(color: ZeroAccent.line, width: ZeroMetrics.hairline),
          ),
          child: const Icon(Icons.shield_outlined, size: 24, color: ZeroAccent.base),
        ),
        const SizedBox(height: ZeroSpace.s3),
        const Text(
          'Zero UI',
          style: TextStyle(
            fontFamily: ZeroFont.ui,
            fontSize: 21,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.3,
            color: ZeroSurface.text,
          ),
        ),
        const SizedBox(height: ZeroSpace.s1),
        const Text('Emergency Device', style: ZeroType.bodyDim),
      ],
    );
  }
}
