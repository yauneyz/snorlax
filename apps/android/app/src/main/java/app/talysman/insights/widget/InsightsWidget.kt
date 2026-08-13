package app.talysman.insights.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.talysman.insights.MainActivity
import app.talysman.insights.data.InsightsRepository
import app.talysman.insights.data.InsightsSummary
import app.talysman.insights.work.RefreshScheduler

object InsightsWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val summary = InsightsRepository(context).cached()
        provideContent { WidgetContent(summary) }
    }
}

class RefreshActionCallback : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        RefreshScheduler.refreshNow(context)
    }
}

private val TextPrimary = ColorProvider(Color.White)
private val TextMuted = ColorProvider(Color(0xFF8B8FA3))

@Composable
private fun WidgetContent(summary: InsightsSummary?) {
    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(Color(0xFF14161A))
            .cornerRadius(16.dp)
            .padding(12.dp)
            .clickable(actionStartActivity<MainActivity>()),
    ) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
            Text(
                text = "Talysman",
                style = TextStyle(color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(modifier = GlanceModifier.defaultWeight())
            Text(
                text = "↻",
                style = TextStyle(color = TextMuted, fontSize = 16.sp),
                modifier = GlanceModifier.clickable(actionRunCallback<RefreshActionCallback>()),
            )
        }
        Spacer(modifier = GlanceModifier.height(8.dp))

        if (summary == null) {
            Text(
                text = "Open the app to load metrics",
                style = TextStyle(color = TextMuted, fontSize = 12.sp),
            )
        } else {
            val dau = summary.activeUsers.data?.dauProtected
            val subs = summary.revenue.data?.activeSubscriptions
            val trials = summary.revenue.data?.activeTrials
            val visitors = summary.funnel.data?.visitors

            MetricRow("DAU (protected)", dau?.toString() ?: "—")
            MetricRow("Active subs", subs?.toString() ?: "—")
            MetricRow("Active trials", trials?.toString() ?: "—")
            MetricRow("Visitors (90d)", visitors?.toString() ?: "—")
        }
    }
}

@Composable
private fun MetricRow(label: String, value: String) {
    Row(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(
            text = label,
            style = TextStyle(color = TextMuted, fontSize = 12.sp),
            modifier = GlanceModifier.defaultWeight(),
        )
        Text(
            text = value,
            style = TextStyle(color = TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold),
        )
    }
}
