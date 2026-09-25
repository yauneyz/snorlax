package app.talysman.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import app.talysman.android.R
import app.talysman.android.TalysmanApp
import app.talysman.android.a11y.TalysmanAccessibilityService
import app.talysman.android.engine.Commands
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.ui.MainActivity
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Keeps Talysman alive and visible (spec §6.2): a persistent notification with what's on, the
 * streak, and "Re-enable all" while an override is running; escalates when the accessibility
 * service (which does the actual blocking) has been switched off. Ticks the engine every minute
 * as a backstop for alarms the system delays.
 */
class EnforcementService : LifecycleService() {
    override fun onCreate() {
        super.onCreate()
        val app = application as TalysmanApp
        ensureChannel()
        startForegroundCompat(render(app.engine.snapshot.value))
        lifecycleScope.launch {
            app.engine.snapshot.collect { notify(render(it)) }
        }
        lifecycleScope.launch {
            while (true) {
                delay(60_000)
                app.engine.tick()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_REENABLE) {
            val app = application as TalysmanApp
            runCatching { app.engine.apply(Commands.reenableAll()) }
        }
        return START_STICKY
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(ID, notification)
        }
    }

    private fun notify(notification: Notification) {
        getSystemService(NotificationManager::class.java)?.notify(ID, notification)
    }

    private fun ensureChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.channel_enforcement), NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun render(snapshot: EngineSnapshot): Notification {
        val active = snapshot.profiles.filter { it.activation.active }
        val protectionOff = snapshot.anyActive && !TalysmanAccessibilityService.isEnabled(this)
        val title = when {
            protectionOff -> "Talysman protection is off"
            active.isEmpty() && snapshot.overridden -> "Blocking is off"
            active.isEmpty() -> "Nothing is blocked"
            active.size == 1 -> "${active[0].profile.name} is on"
            else -> "${active.size} profiles are on"
        }
        val text = if (protectionOff) {
            "Turn Talysman back on in Accessibility settings."
        } else {
            "🔥 ${snapshot.streak.currentDays}-day streak"
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .setPriority(if (protectionOff) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_LOW)
        if (snapshot.overridden) {
            val reenable = PendingIntent.getService(
                this, 1, Intent(this, EnforcementService::class.java).setAction(ACTION_REENABLE), PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(0, "Re-enable all", reenable)
        }
        return builder.build()
    }

    companion object {
        private const val ID = 1
        private const val CHANNEL = "enforcement"
        private const val ACTION_REENABLE = "app.talysman.android.REENABLE_ALL"

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, EnforcementService::class.java)) }
        }
    }
}
