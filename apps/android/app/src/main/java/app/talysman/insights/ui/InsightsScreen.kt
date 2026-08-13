package app.talysman.insights.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.talysman.insights.data.ChannelRow
import app.talysman.insights.data.PlatformFailure
import app.talysman.insights.data.PlatformHealth
import app.talysman.insights.data.RetentionRow

private val Background = Color(0xFF0E0F13)
private val Surface = Color(0xFF181A20)
private val Muted = Color(0xFF8B8FA3)
private val OnSurface = Color(0xFFF4F5F7)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InsightsScreen(viewModel: InsightsViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = { Text("Insights", color = OnSurface, fontWeight = FontWeight.Bold) },
                colors = androidx.compose.material3.TopAppBarDefaults.topAppBarColors(containerColor = Background),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Text(
                        text = "Generated ${state.summary?.generatedAt ?: "—"}",
                        color = Muted,
                        fontSize = 11.sp,
                    )
                }
                state.error?.let { error ->
                    item { PanelCard("Last refresh failed") { Text(error, color = Color(0xFFE0777A), fontSize = 13.sp) } }
                }

                val summary = state.summary
                if (summary == null) {
                    item {
                        Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = OnSurface)
                        }
                    }
                    return@LazyColumn
                }

                item {
                    PanelCard("90-day funnel") {
                        summary.funnel.data?.let { f ->
                            KpiGrid(
                                listOf(
                                    "Visitors" to f.visitors.toString(),
                                    "Downloads" to f.downloaded.toString(),
                                    "Installs" to f.installed.toString(),
                                    "Accounts" to f.accounts.toString(),
                                    "Trials" to f.trials.toString(),
                                    "Paid" to f.paid.toString(),
                                ),
                            )
                        } ?: EmptyState(summary.funnel.ok, summary.funnel.message)
                    }
                }

                item {
                    PanelCard("Active users", "Protected activity is at least 60 seconds of focus.") {
                        summary.activeUsers.data?.let { a ->
                            KpiGrid(
                                listOf(
                                    "DAU protected" to a.dauProtected.toString(),
                                    "DAU UI" to a.dauUi.toString(),
                                    "MAU protected" to a.mauProtected.toString(),
                                    "30d installed base" to a.installedBase30d.toString(),
                                ),
                            )
                        } ?: EmptyState(summary.activeUsers.ok, summary.activeUsers.message)
                    }
                }

                item {
                    PanelCard("Engagement depth") {
                        summary.engagement.data?.let { e ->
                            KpiGrid(
                                listOf(
                                    "Median focus" to "${e.medianFocusMinutes}m",
                                    "Scheduled" to "${e.scheduledFocusHours}h",
                                    "Manual" to "${e.manualFocusHours}h",
                                    "Completed / aborted" to "${e.sessionsCompleted} / ${e.sessionsAborted}",
                                ),
                            )
                        } ?: EmptyState(summary.engagement.ok, summary.engagement.message)
                    }
                }

                item {
                    PanelCard("Revenue") {
                        summary.revenue.data?.let { r ->
                            KpiGrid(
                                listOf(
                                    "Active subs" to r.activeSubscriptions.toString(),
                                    "Active trials" to r.activeTrials.toString(),
                                    "Started" to r.subscriptionsStarted.toString(),
                                    "Cancel intent / ended" to "${r.cancelIntents} / ${r.subscriptionsEnded}",
                                    "Payment failures" to r.paymentsFailed.toString(),
                                    "Refunds" to r.refunds.toString(),
                                ),
                            )
                        } ?: EmptyState(summary.revenue.ok, summary.revenue.message)
                    }
                }

                item {
                    PanelCard("Retention cohorts", "% protected-active at D1 / D7 / D30") {
                        val rows = summary.retention.data
                        if (rows.isNullOrEmpty()) {
                            EmptyState(summary.retention.ok, summary.retention.message)
                        } else {
                            RetentionTable(rows)
                        }
                    }
                }

                item {
                    PanelCard("Desktop install health") {
                        val data = summary.installHealth.data
                        if (data == null || (data.platforms.isEmpty() && data.failures.isEmpty())) {
                            EmptyState(summary.installHealth.ok, summary.installHealth.message)
                        } else {
                            InstallHealthTable(data.platforms, data.failures)
                        }
                    }
                }

                item {
                    PanelCard("Channels", "First-touch source/medium, last 90 days") {
                        val rows = summary.channels.data
                        if (rows.isNullOrEmpty()) {
                            EmptyState(summary.channels.ok, summary.channels.message)
                        } else {
                            ChannelsTable(rows)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PanelCard(title: String, description: String? = null, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface, RoundedCornerShape(14.dp))
            .padding(16.dp),
    ) {
        Text(title, color = OnSurface, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        description?.let { Text(it, color = Muted, fontSize = 11.sp) }
        androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 8.dp))
        content()
    }
}

@Composable
private fun EmptyState(ok: Boolean, message: String?) {
    Text(
        text = if (ok) "No data yet." else (message ?: "Unavailable."),
        color = Muted,
        fontSize = 12.sp,
    )
}

@Composable
private fun KpiGrid(items: List<Pair<String, String>>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { (label, value) -> Kpi(label, value, Modifier.weight(1f)) }
                if (pair.size == 1) androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Kpi(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(label, color = Muted, fontSize = 11.sp)
        Text(value, color = OnSurface, fontWeight = FontWeight.Bold, fontSize = 18.sp)
    }
}

@Composable
private fun RetentionTable(rows: List<RetentionRow>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        TableHeader(listOf("Week", "Devices", "D1", "D7", "D30"))
        rows.take(8).forEach { row ->
            TableRow(
                listOf(
                    row.cohortWeek,
                    row.devices.toString(),
                    row.d1Pct?.let { "$it%" } ?: "—",
                    row.d7Pct?.let { "$it%" } ?: "—",
                    row.d30Pct?.let { "$it%" } ?: "—",
                ),
            )
        }
    }
}

@Composable
private fun InstallHealthTable(platforms: List<PlatformHealth>, failures: List<PlatformFailure>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (platforms.isNotEmpty()) {
            TableHeader(listOf("Platform", "Installed", "Service", "Extension"))
            platforms.forEach { p ->
                TableRow(listOf(p.platform, p.appInstalled.toString(), p.serviceInstalled.toString(), p.extensionConnected.toString()))
            }
        }
        failures.forEach { f ->
            Text("${f.platform}  ${f.reason}: ${f.count}", color = Color(0xFFE0777A), fontSize = 11.sp)
        }
    }
}

@Composable
private fun ChannelsTable(rows: List<ChannelRow>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        TableHeader(listOf("Channel", "Visitors", "Trials", "Paid", "→Paid"))
        rows.take(8).forEach { row ->
            TableRow(
                listOf(
                    "${row.channel} / ${row.medium}",
                    row.visitors.toString(),
                    row.trials.toString(),
                    row.paid.toString(),
                    "${row.pctVisitorToPaid}%",
                ),
            )
        }
    }
}

@Composable
private fun TableHeader(labels: List<String>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        labels.forEach { Text(it, color = Muted, fontSize = 10.sp, modifier = Modifier.weight(1f)) }
    }
}

@Composable
private fun TableRow(values: List<String>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        values.forEach { Text(it, color = OnSurface, fontSize = 11.sp, modifier = Modifier.weight(1f)) }
    }
}
