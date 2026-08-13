package app.talysman.insights.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import app.talysman.insights.work.RefreshScheduler

class InsightsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = InsightsWidget

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        RefreshScheduler.ensureScheduled(context)
        RefreshScheduler.refreshNow(context)
    }
}
