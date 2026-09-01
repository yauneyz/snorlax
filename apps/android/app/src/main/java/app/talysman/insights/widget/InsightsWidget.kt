package app.talysman.insights.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.talysman.insights.MainActivity
import app.talysman.insights.data.InsightsRepository
import app.talysman.insights.data.InsightsSummary
import app.talysman.insights.ui.TalysmanPalette

object InsightsWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val summary = InsightsRepository(context).cached()
        provideContent { WidgetContent(summary) }
    }
}

private val TextPrimary = ColorProvider(TalysmanPalette.ForegroundStrong)
private val TextMuted = ColorProvider(TalysmanPalette.ForegroundMuted)

@Composable
private fun WidgetContent(summary: InsightsSummary?) {
    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(TalysmanPalette.PanelRaised)
            .cornerRadius(16.dp)
            .padding(12.dp)
            .clickable(actionStartActivity<MainActivity>()),
    ) {
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
            val downloads = summary.funnel.data?.downloaded

            MetricRow("Visitors (90d)", visitors?.toString() ?: "—")
            MetricRow("Downloads (90d)", downloads?.toString() ?: "—")
            MetricRow("DAU (protected)", dau?.toString() ?: "—")
            MetricRow("Active trials", trials?.toString() ?: "—")
            MetricRow("Active subs", subs?.toString() ?: "—")
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
