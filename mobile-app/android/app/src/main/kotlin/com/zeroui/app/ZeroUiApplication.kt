package com.zeroui.app

import android.app.Application
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel

/**
 * Holds the single Flutter engine for the whole process.
 *
 * ## Why the engine lives here and not in the Activity
 *
 * The emergency can be triggered by three volume-down presses with no screen
 * open. When that happens the Activity does not exist, so a Dart isolate owned
 * by the Activity would not be running — and the isolate is what owns the device
 * identity, the API client, the GPS fix, the microphone and the offline outbox.
 *
 * By owning the engine here, and by telling `MainActivity` not to destroy it
 * with the host, the isolate keeps running for as long as the process does. The
 * monitoring foreground service keeps the process alive, so the trigger always
 * has somewhere to land.
 *
 * This is deliberately *not* a second implementation of the emergency: the
 * native side only counts presses and forwards them. Everything else stays in
 * Dart, where it already was.
 */
class ZeroUiApplication : Application() {

    private var sharedEngine: FlutterEngine? = null
    private val lock = Any()

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    /** The process-wide engine, created on first use. */
    fun engine(): FlutterEngine = synchronized(lock) {
        sharedEngine?.let { return it }

        val engine = FlutterEngine(this)
        // Assign before executing: the Dart entrypoint may call straight back
        // into the channel below.
        sharedEngine = engine

        engine.dartExecutor.executeDartEntrypoint(
            DartExecutor.DartEntrypoint.createDefault()
        )

        // Native → Dart for hardware triggers is a different channel
        // (`in.zeroui/trigger`, see TriggerBridge). This handler covers the
        // Dart → native direction on the same channel.
        MethodChannel(engine.dartExecutor.binaryMessenger, TriggerBridge.CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "gesture" -> result.success(TriggerBridge.gesture())
                    "simulateTrigger" -> {
                        val presses = call.argument<Int>("presses") ?: 3
                        result.success(EmergencyForegroundService.triggerNow(presses))
                    }
                    else -> result.notImplemented()
                }
            }

        engine
    }

    companion object {
        @Volatile
        var instance: ZeroUiApplication? = null
            private set
    }
}
