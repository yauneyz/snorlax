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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.talysman.insights.data.BlogPostRow
import app.talysman.insights.data.ChannelRow
import app.talysman.insights.data.TrailRow
import app.talysman.insights.data.VisitorBreakdownRow

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InsightsScreen(viewModel: InsightsViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        containerColor = TalysmanPalette.Background,
        topBar = {
            TopAppBar(
                title = { Text("Insights", color = TalysmanPalette.ForegroundStrong, fontWeight = FontWeight.Bold) },
                colors = androidx.compose.material3.TopAppBarDefaults.topAppBarColors(containerColor = TalysmanPalette.Background),
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
                        color = TalysmanPalette.ForegroundMuted,
                        fontSize = 11.sp,
                    )
                }
                state.error?.let { error ->
                    item { PanelCard("Last refresh failed") { Text(error, color = TalysmanPalette.DangerInk, fontSize = 13.sp) } }
                }

                val summary = state.summary
                if (summary == null) {
                    item {
                        Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = TalysmanPalette.ForegroundStrong)
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
                                    "Paired" to f.paired.toString(),
                                    "Activated" to f.activated.toString(),
                                    "Trials" to f.trials.toString(),
                                    "Paid" to f.paid.toString(),
                                ),
                            )
                        } ?: EmptyState(summary.funnel.ok, summary.funnel.message)
                    }
                }

                item {
                    PanelCard("Revenue", "Right now · active excludes anything set to cancel at period end") {
                        summary.revenue.data?.let { r ->
                            KpiGrid(
                                listOf(
                                    "Active subs" to r.activeSubscriptions.toString(),
                                    "Active trials" to r.activeTrials.toString(),
                                    "MRR (list)" to "$" + "%,d".format(r.mrrCents / 100),
                                    "Lifetime customers" to r.lifetimeCustomers.toString(),
                                    "Canceling subs / trials" to "${r.cancelingSubscriptions} / ${r.cancelingTrials}",
                                    "Payment failures" to r.paymentsFailed.toString(),
                                ),
                            )
                        } ?: EmptyState(summary.revenue.ok, summary.revenue.message)
                    }
                }

                item {
                    PanelCard("Acquisition channels", "First-touch funnel, device type, and OS · last 90 days") {
                        val rows = summary.channels.data
                        if (rows.isNullOrEmpty()) {
                            EmptyState(summary.channels.ok, summary.channels.message)
                        } else {
                            ChannelsTable(rows)
                        }
                        val breakdown = summary.visitorBreakdown.data
                        if (breakdown != null) {
                            BreakdownTable("Device type", breakdown.deviceTypes)
                            BreakdownTable("Operating system", breakdown.operatingSystems)
                        } else if (!summary.visitorBreakdown.ok) {
                            EmptyState(false, summary.visitorBreakdown.message)
                        }
                    }
                }

                item {
                    PanelCard("Channel trail", "All time · every person on all three layers · Now = active trials / subs") {
                        val trail = summary.trail.data
                        if (trail == null) {
                            EmptyState(summary.trail.ok, summary.trail.message)
                        } else {
                            TrailTable("Source", trail.sources)
                            TrailTable("Blog", trail.blog)
                            TrailTable("Affiliate", trail.affiliates)
                            JourneyList(trail.journeys)
                        }
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
                    PanelCard("Blog", "Per post · last 90 days · paired / trials / paid are people who read it first or clicked its CTA") {
                        val rows = summary.blogPosts.data
                        if (rows.isNullOrEmpty()) {
                            EmptyState(summary.blogPosts.ok, summary.blogPosts.message)
                        } else {
                            BlogPostsTable(rows)
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
            .background(TalysmanPalette.PanelRaised, RoundedCornerShape(14.dp))
            .padding(16.dp),
    ) {
        Text(title, color = TalysmanPalette.ForegroundStrong, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        description?.let { Text(it, color = TalysmanPalette.ForegroundMuted, fontSize = 11.sp) }
        androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 8.dp))
        content()
    }
}

@Composable
private fun EmptyState(ok: Boolean, message: String?) {
    Text(
        text = if (ok) "No data yet." else (message ?: "Unavailable."),
        color = TalysmanPalette.ForegroundMuted,
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
        Text(label, color = TalysmanPalette.ForegroundMuted, fontSize = 11.sp)
        Text(value, color = TalysmanPalette.ForegroundStrong, fontWeight = FontWeight.Bold, fontSize = 18.sp)
    }
}

@Composable
private fun ChannelsTable(rows: List<ChannelRow>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        TableHeader(listOf("Channel", "Visit", "Paired", "Acct", "Trial", "Paid"))
        rows.take(8).forEach { row ->
            TableRow(
                listOf(
                    "${row.channel} / ${row.medium}",
                    row.visitors.toString(),
                    row.paired?.toString() ?: "—",
                    row.accounts.toString(),
                    row.trials.toString(),
                    row.paid.toString(),
                ),
            )
        }
    }
}

@Composable
private fun TrailTable(title: String, rows: List<TrailRow>) {
    if (rows.isEmpty()) return
    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = TalysmanPalette.ForegroundStrong, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
        TableHeader(listOf("Channel", "People", "Paired", "Trial", "Paid", "Now"))
        rows.take(10).forEach { row ->
            TableRow(
                listOf(
                    row.channel,
                    row.people.toString(),
                    row.paired.toString(),
                    row.trials.toString(),
                    (row.paid + row.lifetime).toString(),
                    "${row.activeTrials} / ${row.activeSubs}",
                ),
            )
        }
    }
}

// Journeys are long ("chatgpt → attention-armor (blog) → maya (affiliate)"), so each gets its
// own line above its numbers instead of a squeezed first column.
@Composable
private fun JourneyList(rows: List<TrailRow>) {
    if (rows.isEmpty()) return
    Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Journeys", color = TalysmanPalette.ForegroundStrong, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
        TableHeader(listOf("People", "Paired", "Trial", "Paid", "Now"))
        rows.take(12).forEach { row ->
            Column {
                Text(row.channel, color = TalysmanPalette.ForegroundStrong, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                TableRow(
                    listOf(
                        row.people.toString(),
                        row.paired.toString(),
                        row.trials.toString(),
                        (row.paid + row.lifetime).toString(),
                        "${row.activeTrials} / ${row.activeSubs}",
                    ),
                )
            }
        }
    }
}

@Composable
private fun BlogPostsTable(rows: List<BlogPostRow>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        TableHeader(listOf("Post", "Views", "CTA", "Paired", "Trial", "Paid"))
        rows.take(10).forEach { row ->
            TableRow(
                listOf(
                    row.slug,
                    row.views.toString(),
                    row.ctaClickers.toString(),
                    row.linkedPaired.toString(),
                    row.linkedTrials.toString(),
                    row.linkedPaid.toString(),
                ),
            )
        }
    }
}

@Composable
private fun BreakdownTable(title: String, rows: List<VisitorBreakdownRow>) {
    if (rows.isEmpty()) return
    Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = TalysmanPalette.ForegroundStrong, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
        rows.forEach { row ->
            TableRow(listOf(row.label, row.visitors.toString(), "${row.pctVisitors}%"))
        }
    }
}

@Composable
private fun TableHeader(labels: List<String>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        labels.forEach { Text(it, color = TalysmanPalette.ForegroundMuted, fontSize = 10.sp, modifier = Modifier.weight(1f)) }
    }
}

@Composable
private fun TableRow(values: List<String>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        values.forEach { Text(it, color = TalysmanPalette.ForegroundStrong, fontSize = 11.sp, modifier = Modifier.weight(1f)) }
    }
}
