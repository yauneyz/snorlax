package app.talysman.android.service

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import app.talysman.android.TalysmanApp

/**
 * Wakes the engine at its `nextWakeMs` (schedule edges, pool expiry, timed overrides, local
 * midnight — never more than an hour away). Exact alarms when the user allowed them, otherwise
 * inexact ones; the foreground service also ticks every minute while it runs.
 */
object WakeScheduler {
    private const val REQUEST = 1

    fun schedule(context: Context, atMs: Long) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        val intent = PendingIntent.getBroadcast(
            context,
            REQUEST,
            Intent(context, TickReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()
        if (exact) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, intent)
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, intent)
        }
    }
}

/** The engine's wake-up alarm. */
class TickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        (context.applicationContext as TalysmanApp).engine.tick()
    }
}

/** Boot, app update, and clock / time-zone changes: re-tick and make sure the service runs. */
class SystemEventReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as TalysmanApp
        app.engine.tick()
        EnforcementService.start(context)
    }
}
