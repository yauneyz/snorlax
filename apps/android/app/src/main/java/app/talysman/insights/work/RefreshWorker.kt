package app.talysman.insights.work

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.talysman.insights.data.InsightsRepository
import app.talysman.insights.widget.InsightsWidget

class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repository = InsightsRepository(applicationContext)
        val outcome = repository.refresh()
        // Best-effort: an errors-fetch failure shouldn't fail the widget's own refresh/retry.
        repository.refreshErrors()
        InsightsWidget.updateAll(applicationContext)
        return if (outcome.isSuccess) Result.success() else Result.retry()
    }
}
