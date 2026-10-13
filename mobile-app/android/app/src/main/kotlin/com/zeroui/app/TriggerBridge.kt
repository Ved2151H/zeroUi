package com.zeroui.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.util.Log
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * The hardware emergency trigger.
 * ==============================
 *
 * ## Why volume-down instead of the power button
 *
 * The product brief asked for "3× the physical power button". Android does not
 * allow that for an ordinary application:
 *
 *  * `KEYCODE_POWER` is consumed by the system (`PhoneWindowManager`) before it
 *    is dispatched to any app, so an `Activity.onKeyDown` for it is never
 *    called;
 *  * there is no public API that reports a power-key press;
 *  * the only adjacent signals, `ACTION_SCREEN_ON` / `ACTION_SCREEN_OFF`, fire
 *    for screen timeouts and every other cause as well, so counting them would
 *    let a phone in a pocket dispatch an emergency by itself.
 *
 * The implementable equivalent is **three rapid volume-down presses**, counted
 * natively inside the foreground service so it still works with the screen
 * locked and the app closed. It needs no extra permission and cannot be
 * confused with anything Android does on its own.
 *
 * ## How the presses are observed
 *
 * `AudioManager.ACTION_VOLUME_CHANGED` is delivered when the volume of a stream
 * actually changes, with the previous and new values. A press is only counted
 * when the stream is music and the value genuinely decreased, which rejects
 * spurious events and volume *increases* (a person turning the sound up while
 * watching a video must never arm an emergency).
 *
 * Known limitation, stated rather than hidden: if the music volume is already
 * at zero, pressing volume-down changes nothing, so no broadcast arrives and
 * that press is not counted. The gesture therefore needs a little headroom —
 * which is the normal state of a phone's media volume.
 */
class VolumeTriplePressDetector(
    val requiredPresses: Int = 3,
    val windowMs: Long = 1500L,
    private val onTriggered: (Int) -> Unit,
) {
    private val stamps = ArrayDeque<Long>()

    @Volatile
    var armed: Boolean = false
        private set

    private var receiver: BroadcastReceiver? = null

    fun start(context: Context) {
        if (receiver != null) return

        val listener = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != ACTION_VOLUME_CHANGED) return
                val stream = intent.getIntExtra(EXTRA_VOLUME_STREAM_TYPE, -1)
                val value = intent.getIntExtra(EXTRA_VOLUME_STREAM_VALUE, -1)
                val previous = intent.getIntExtra(EXTRA_PREVIOUS_VOLUME_STREAM_VALUE, -1)
                if (stream != AudioManager.STREAM_MUSIC) return
                if (previous < 0 || value < 0 || value >= previous) return
                registerPress()
            }
        }

        val filter = IntentFilter(ACTION_VOLUME_CHANGED)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // EXPORTED is deliberate: ACTION_VOLUME_CHANGED is a protected
                // broadcast, so only the system can send it, and a
                // NOT_EXPORTED receiver would not receive it on some builds.
                context.registerReceiver(listener, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                context.registerReceiver(listener, filter)
            }
            receiver = listener
            armed = true
        } catch (error: Exception) {
            Log.w(TAG, "Could not register the volume listener: ${error.message}")
            armed = false
        }
    }

    fun stop(context: Context) {
        receiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: Exception) {
            }
        }
        receiver = null
        armed = false
        stamps.clear()
    }

    /** Record one accepted press and fire when the gesture completes. */
    @Synchronized
    fun registerPress() {
        val now = System.currentTimeMillis()
        stamps.addLast(now)
        while (stamps.isNotEmpty() && now - stamps.first() > windowMs) {
            stamps.removeFirst()
        }
        if (stamps.size >= requiredPresses) {
            val presses = stamps.size
            stamps.clear()
            Log.i(TAG, "Hardware trigger: $presses presses within ${windowMs}ms")
            onTriggered(presses)
        }
    }
}

/**
 * Native → Dart delivery for the trigger.
 *
 * The gesture is counted in the service, but the emergency itself is created by
 * the Dart isolate, which already owns the device identity, the API client, the
 * location fix, the audio capture and the outbox. Duplicating any of that in
 * Kotlin would create exactly the second implementation the project forbids.
 */
object TriggerBridge {
    const val CHANNEL = "in.zeroui/trigger"

    @Volatile
    var detector: VolumeTriplePressDetector? = null
        private set

    fun attach(detector: VolumeTriplePressDetector?) {
        this.detector = detector
    }

    /** Current gesture, reported to the UI so it never describes a gesture the
     *  native side does not actually implement. */
    fun gesture(): Map<String, Any> {
        val d = detector
        return mapOf(
            "presses" to (d?.requiredPresses ?: 3),
            "windowMs" to (d?.windowMs ?: 1500L),
            "armed" to (d?.armed ?: false),
            "button" to "volume_down",
        )
    }

    /** Send an accepted gesture to the running Dart isolate. */
    fun deliver(engine: FlutterEngine?, presses: Int): Boolean {
        val target = engine ?: return false
        return try {
            MethodChannel(target.dartExecutor.binaryMessenger, CHANNEL)
                .invokeMethod("hardwareTrigger", mapOf("presses" to presses))
            true
        } catch (error: Exception) {
            Log.w(TAG, "Could not deliver the trigger to Dart: ${error.message}")
            false
        }
    }
}

private const val ACTION_VOLUME_CHANGED = "android.media.VOLUME_CHANGED_ACTION"
private const val EXTRA_VOLUME_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
private const val EXTRA_VOLUME_STREAM_VALUE = "android.media.EXTRA_VOLUME_STREAM_VALUE"
private const val EXTRA_PREVIOUS_VOLUME_STREAM_VALUE =
    "android.media.EXTRA_PREVIOUS_VOLUME_STREAM_VALUE"

private const val TAG = "ZeroUiTrigger"
