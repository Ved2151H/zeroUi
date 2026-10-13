import 'package:flutter/services.dart';

/// The hardware emergency trigger.
///
/// ## Why this is not the power button
///
/// The original requirement was "3× the physical power button". Android does
/// not permit that for a normal application: `KEYCODE_POWER` is consumed by the
/// system before it is dispatched to any app, no public API reports a power-key
/// press, and the only related signals (`ACTION_SCREEN_ON` / `ACTION_SCREEN_OFF`)
/// fire for screen timeouts and every other cause as well. Counting those would
/// mean a phone in a pocket could dispatch an emergency on its own, which is
/// worse than having no hardware trigger at all.
///
/// The implementable equivalent is three rapid presses of **volume-down**,
/// detected natively inside the foreground service. It works with the app
/// closed and the screen locked, it needs no special permission, and it cannot
/// be confused with anything the system does by itself.
///
/// ## Flow
///
/// `volume-down ×3 within 1.5 s`
///   → `EmergencyForegroundService` counts the presses
///   → `in.zeroui/trigger` reaches this isolate
///   → [EmergencyController.triggerImmediateEmergency], no countdown
class HardwareTriggerBridge {
  HardwareTriggerBridge._();

  static const MethodChannel _channel = MethodChannel('in.zeroui/trigger');

  /// True once a handler is attached. The native side reports its own arming
  /// state separately, so this only tracks whether *this* isolate is listening.
  static bool listening = false;

  /// Handle triggers coming from the native service.
  ///
  /// [onTrigger] is called for every accepted three-press gesture. It receives
  /// the press count the service measured, which is recorded on the emergency
  /// so the authority can see how the incident started.
  static void listen(void Function(int presses) onTrigger) {
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'hardwareTrigger') return null;
      final args = call.arguments;
      final presses = args is Map && args['presses'] is int ? args['presses'] as int : 3;
      onTrigger(presses);
      return true;
    });
    listening = true;
  }

  /// Ask the native service how many presses it requires and how quickly.
  /// Used by the settings screen to show the real gesture, not a description of
  /// one.
  static Future<Map<String, dynamic>> gesture() async {
    try {
      final result = await _channel.invokeMethod<Map<Object?, Object?>>('gesture');
      if (result == null) return const {};
      return {for (final entry in result.entries) '${entry.key}': entry.value};
    } on PlatformException {
      return const {};
    } on MissingPluginException {
      return const {};
    }
  }

  /// Fire a trigger without touching the hardware. Only reachable from the
  /// developer section, and it goes through the same code path as a real
  /// gesture so the test exercises production behaviour.
  static Future<bool> simulate({int presses = 3}) async {
    try {
      return await _channel.invokeMethod<bool>('simulateTrigger', {'presses': presses}) ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
