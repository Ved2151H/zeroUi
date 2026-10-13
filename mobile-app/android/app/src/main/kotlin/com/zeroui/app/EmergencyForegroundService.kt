package com.zeroui.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Zero UI foreground service
 * ==========================
 *
 * Android only keeps a process — and therefore its sensors, location updates,
 * microphone capture, uploads and Dart isolate — alive while the app is in the
 * foreground or while a foreground service is running. This service has two
 * modes:
 *
 *  * **monitoring** — started when the app enters PASSIVE MODE. Its job is to
 *    stop Android reclaiming the process, and to host the volume-down
 *    triple-press detector so the emergency gesture works with the screen
 *    locked and the app closed. The notification is silent and low priority.
 *
 *  * **emergency** — started when an emergency becomes live. Types
 *    `location | microphone | dataSync`, with an ongoing high-priority
 *    notification, matching the three things an active emergency actually does.
 *
 * The service holds no emergency logic. It counts presses and forwards them;
 * the Dart isolate owns everything else.
 */
class EmergencyForegroundService : Service() {

    companion object {
        const val CHANNEL_EMERGENCY = "zeroui_emergency"
        const val CHANNEL_MONITORING = "zeroui_monitoring"
        const val NOTIFICATION_ID = 4711

        const val ACTION_START = "com.zeroui.app.action.START"
        const val ACTION_UPDATE = "com.zeroui.app.action.UPDATE"
        const val ACTION_STOP = "com.zeroui.app.action.STOP"

        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_MODE = "mode"

        const val MODE_MONITORING = "monitoring"
        const val MODE_EMERGENCY = "emergency"

        /** Set while the service is alive, so a developer action can reach the
         *  same trigger path the hardware uses. */
        @Volatile
        private var active: EmergencyForegroundService? = null

        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(context: Context, title: String, text: String, mode: String = MODE_EMERGENCY) {
            val intent = Intent(context, EmergencyForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_TEXT, text)
                putExtra(EXTRA_MODE, mode)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun update(context: Context, title: String, text: String) {
            val intent = Intent(context, EmergencyForegroundService::class.java).apply {
                action = ACTION_UPDATE
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_TEXT, text)
            }
            context.startService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, EmergencyForegroundService::class.java))
        }

        /**
         * Raise the trigger without touching the hardware.
         *
         * Runs through [handleTrigger] exactly like a real gesture, so the
         * developer action tests production behaviour rather than a shortcut.
         */
        fun triggerNow(presses: Int = 3): Boolean {
            val running = active
            if (running != null) {
                running.handleTrigger(presses)
                return true
            }
            // No service running: still deliver, so the activation path can be
            // exercised from the settings screen.
            val engine = ZeroUiApplication.instance?.engine()
            return TriggerBridge.deliver(engine, presses)
        }
    }

    private val detector = VolumeTriplePressDetector(
        requiredPresses = 3,
        windowMs = 1500L,
        onTriggered = { presses -> handleTrigger(presses) },
    )

    private var mode: String = MODE_EMERGENCY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        active = this
        createNotificationChannels()
        TriggerBridge.attach(detector)
        // Armed in both modes: during an emergency the Dart side ignores a
        // duplicate trigger, and keeping one registration avoids a gap when the
        // service switches mode.
        detector.start(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForegroundCompat()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: defaultTitle()
                val text = intent.getStringExtra(EXTRA_TEXT) ?: defaultText()
                if (isRunning) {
                    notificationManager().notify(
                        NOTIFICATION_ID,
                        buildNotification(title, text, mode, ongoing = true, alert = false)
                    )
                }
            }
            else -> {
                mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_EMERGENCY
                val title = intent?.getStringExtra(EXTRA_TITLE) ?: defaultTitle()
                val text = intent?.getStringExtra(EXTRA_TEXT) ?: defaultText()
                val notification = buildNotification(
                    title,
                    text,
                    mode,
                    ongoing = true,
                    alert = mode == MODE_EMERGENCY,
                )
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    foregroundTypes(),
                )
                isRunning = true
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        detector.stop(this)
        TriggerBridge.attach(null)
        active = null
        isRunning = false
        super.onDestroy()
    }

    /**
     * A completed three-press gesture.
     *
     * Delivery goes to the Dart isolate, which creates the emergency with no
     * countdown. If no isolate is attached the Activity is raised instead, so
     * the user still sees the emergency screen — note that Android restricts
     * background activity starts, so this fallback is best-effort by design.
     */
    private fun handleTrigger(presses: Int) {
        Log.i(TAG, "Hardware trigger accepted: $presses presses")
        val engine = (application as? ZeroUiApplication)?.engine()
        val delivered = TriggerBridge.deliver(engine, presses)
        if (!delivered) {
            val open = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(MainActivity.EXTRA_TRIGGER_PRESSES, presses)
            }
            try {
                startActivity(open)
            } catch (error: Exception) {
                Log.w(TAG, "Could not raise the emergency screen: ${error.message}")
            }
        }
        notificationManager().notify(
            NOTIFICATION_ID,
            buildNotification(
                "Zero UI emergency",
                "Activated by the hardware button — no verification window",
                MODE_EMERGENCY,
                ongoing = true,
                alert = true,
            )
        )
    }

    private fun defaultTitle() = if (mode == MODE_MONITORING) {
        "Zero UI monitoring"
    } else {
        "Zero UI emergency active"
    }

    private fun defaultText() = if (mode == MODE_MONITORING) {
        "Watching sensors · press volume-down three times for emergency"
    } else {
        "Sending location, audio and status updates"
    }

    private fun foregroundTypes(): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
        return if (mode == MODE_MONITORING) {
            // `specialUse` rather than `dataSync`: Android 15 caps dataSync
            // foreground services at six hours in any twenty-four, which would
            // silently end passive monitoring on a phone carried all day.
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        }
    }

    private fun stopForegroundCompat() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        isRunning = false
    }

    private fun notificationManager() =
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = notificationManager()

        if (manager.getNotificationChannel(CHANNEL_EMERGENCY) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_EMERGENCY,
                    "Emergency session",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Keeps emergency location, audio and uploads running"
                    setShowBadge(true)
                    enableVibration(true)
                }
            )
        }

        if (manager.getNotificationChannel(CHANNEL_MONITORING) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_MONITORING,
                    "Background monitoring",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    // Silent by design: a monitoring notification that buzzes
                    // would train the user to dismiss it.
                    description = "Keeps sensor monitoring and the emergency button armed"
                    setShowBadge(false)
                    enableVibration(false)
                    setSound(null, null)
                }
            )
        }
    }

    private fun buildNotification(
        title: String,
        text: String,
        mode: String,
        ongoing: Boolean,
        alert: Boolean,
    ): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val channel = if (mode == MODE_MONITORING) CHANNEL_MONITORING else CHANNEL_EMERGENCY

        return NotificationCompat.Builder(this, channel)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setPriority(
                if (alert) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_LOW
            )
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp)
            .build()
    }

    private val TAG = "ZeroUiForeground"
}
