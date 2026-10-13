package com.zeroui.app

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Bridge between Dart and the native emergency foreground service.
 *
 * Channel: `in.zeroui/foreground`
 *   start  {title, text, mode} → start (or switch) the foreground service
 *   update {title, text}       → refresh the ongoing notification
 *   stop                       → stop the service
 *   isRunning                  → bool
 *   platformInfo               → {sdkInt, osVersion, manufacturer, model}
 *
 * The Activity deliberately does **not** own the Flutter engine: it is provided
 * by [ZeroUiApplication] and survives the Activity. That is what lets a
 * volume-down triple press create an emergency while no screen is open — see
 * [ZeroUiApplication] for the reasoning.
 */
class MainActivity : FlutterActivity() {

    private val channelName = "in.zeroui/foreground"
    private var permissionBridge: PermissionBridge? = null

    override fun provideFlutterEngine(context: Context): FlutterEngine =
        (application as ZeroUiApplication).engine()

    /**
     * Keep the engine (and therefore the Dart isolate, the API client and the
     * offline outbox) alive when the user leaves the app. The monitoring
     * foreground service is what keeps the process itself alive.
     */
    override fun shouldDestroyEngineWithHost(): Boolean = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Native runtime-permission handling (replaces permission_handler, whose
        // Android plugin requires a newer AGP than this project ships).
        permissionBridge = PermissionBridge(this, flutterEngine.dartExecutor.binaryMessenger)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "start" -> {
                        val title = call.argument<String>("title") ?: "Zero UI emergency active"
                        val text = call.argument<String>("text") ?: "Emergency session running"
                        val mode = call.argument<String>("mode")
                            ?: EmergencyForegroundService.MODE_EMERGENCY
                        try {
                            EmergencyForegroundService.start(applicationContext, title, text, mode)
                            result.success(true)
                        } catch (error: Exception) {
                            result.error("start_failed", error.message, null)
                        }
                    }

                    "update" -> {
                        val title = call.argument<String>("title") ?: "Zero UI emergency active"
                        val text = call.argument<String>("text") ?: "Emergency session running"
                        try {
                            if (EmergencyForegroundService.isRunning) {
                                EmergencyForegroundService.update(applicationContext, title, text)
                            }
                            result.success(true)
                        } catch (error: Exception) {
                            result.error("update_failed", error.message, null)
                        }
                    }

                    "stop" -> {
                        EmergencyForegroundService.stop(applicationContext)
                        result.success(true)
                    }

                    "isRunning" -> result.success(EmergencyForegroundService.isRunning)

                    "platformInfo" -> result.success(
                        mapOf(
                            "sdkInt" to Build.VERSION.SDK_INT,
                            "osVersion" to Build.VERSION.RELEASE,
                            "manufacturer" to Build.MANUFACTURER,
                            "model" to Build.MODEL
                        )
                    )

                    else -> result.notImplemented()
                }
            }

        consumeTrigger(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeTrigger(intent)
    }

    /**
     * A trigger that could not be delivered to a running isolate arrives here as
     * an intent extra, so the emergency still starts with no verification
     * window once the app is up.
     */
    private fun consumeTrigger(source: Intent?) {
        val presses = source?.getIntExtra(EXTRA_TRIGGER_PRESSES, 0) ?: 0
        if (presses <= 0) return
        source?.removeExtra(EXTRA_TRIGGER_PRESSES)
        val engine = (application as? ZeroUiApplication)?.engine()
        val delivered = TriggerBridge.deliver(engine, presses)
        if (!delivered) Log.w("ZeroUiMainActivity", "Trigger intent could not be delivered")
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        permissionBridge?.onRequestPermissionsResult(requestCode, grantResults)
    }

    companion object {
        const val EXTRA_TRIGGER_PRESSES = "com.zeroui.app.extra.TRIGGER_PRESSES"
    }
}
