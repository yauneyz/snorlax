package app.talysman.insights.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object RefreshScheduler {
    private const val PERIODIC_NAME = "insights-refresh-periodic"
    private const val ONE_TIME_NAME = "insights-refresh-now"
    private val NETWORK_CONSTRAINTS = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /** Idempotent: safe to call from every entry point (app launch, widget added). */
    fun ensureScheduled(context: Context) {
        val request = PeriodicWorkRequestBuilder<RefreshWorker>(30, TimeUnit.MINUTES)
            .setConstraints(NETWORK_CONSTRAINTS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun refreshNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<RefreshWorker>()
            .setConstraints(NETWORK_CONSTRAINTS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(ONE_TIME_NAME, ExistingWorkPolicy.REPLACE, request)
    }
}
