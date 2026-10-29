package app.talysman.insights.data

import kotlinx.serialization.Serializable

// Mirrors the JSON contract of GET /api/analytics/summary
// (apps/web/src/app/api/analytics/summary/route.ts). Keep in sync by hand — it's a small,
// stable, hand-rolled contract rather than a generated client.

@Serializable
data class InsightsSummary(
    val generatedAt: String,
    val funnel: FunnelSection,
    val activeUsers: ActiveUsersSection,
    val engagement: EngagementSection,
    val revenue: RevenueSection,
    val retention: RetentionSection,
    val installHealth: InstallHealthSection,
    val channels: ChannelsSection,
    val visitorBreakdown: VisitorBreakdownSection = VisitorBreakdownSection(ok = true),
    // Defaulted like visitorBreakdown above: cached JSON written before this field existed
    // (SharedPreferences in InsightsRepository) must still deserialize without it.
    val pmf: PmfSection = PmfSection(ok = true),
    // Defaulted for the same reason; added with the blog channel (migration 0021).
    val blogPosts: BlogPostsSection = BlogPostsSection(ok = true),
    // The channel trail (migration 0022). Defaulted like the sections above.
    val trail: TrailSection = TrailSection(ok = true),
)

@Serializable
data class FunnelSection(val ok: Boolean, val data: FunnelData? = null, val message: String? = null)

@Serializable
data class FunnelData(
    val visitors: Long,
    val downloaded: Long,
    val installed: Long,
    val accounts: Long,
    val paired: Long,
    val activated: Long,
    val trials: Long,
    val paid: Long,
    val medianVisitToDownloadSeconds: Double? = null,
    val medianInstallToValueSeconds: Double? = null,
)

@Serializable
data class ActiveUsersSection(val ok: Boolean, val data: ActiveUsersData? = null, val message: String? = null)

@Serializable
data class ActiveUsersData(
    val dauProtected: Long,
    val dauUi: Long,
    val mauProtected: Long,
    val installedBase30d: Long,
    val series: List<DauPoint> = emptyList(),
)

@Serializable
data class DauPoint(val date: String, val dauProtected: Long)

@Serializable
data class EngagementSection(val ok: Boolean, val data: EngagementData? = null, val message: String? = null)

@Serializable
data class EngagementData(
    val medianFocusMinutes: Double = 0.0,
    val scheduledFocusHours: Double = 0.0,
    val manualFocusHours: Double = 0.0,
    val sessionsCompleted: Long = 0,
    val sessionsAborted: Long = 0,
)

@Serializable
data class RevenueSection(val ok: Boolean, val data: RevenueData? = null, val message: String? = null)

@Serializable
data class RevenueData(
    val activeSubscriptions: Long,
    val activeTrials: Long,
    val subscriptionsStarted: Long,
    val cancelIntents: Long,
    val subscriptionsEnded: Long,
    val paymentsFailed: Long,
    val refunds: Long,
    // Active subs/trials exclude cancel-at-period-end; these count the ones that are leaving.
    // Defaulted so a server that predates them still parses.
    val cancelingSubscriptions: Long = 0,
    val cancelingTrials: Long = 0,
    val lifetimeCustomers: Long = 0,
    val mrrCents: Long = 0,
)

@Serializable
data class RetentionSection(val ok: Boolean, val data: List<RetentionRow>? = null, val message: String? = null)

@Serializable
data class RetentionRow(
    val cohortWeek: String,
    val devices: Long,
    val d1Pct: Int? = null,
    val d7Pct: Int? = null,
    val d30Pct: Int? = null,
)

@Serializable
data class InstallHealthSection(val ok: Boolean, val data: InstallHealthData? = null, val message: String? = null)

@Serializable
data class InstallHealthData(
    val platforms: List<PlatformHealth> = emptyList(),
    val failures: List<PlatformFailure> = emptyList(),
)

@Serializable
data class PlatformHealth(
    val platform: String,
    val appInstalled: Long,
    val serviceInstalled: Long,
    val extensionConnected: Long,
)

@Serializable
data class PlatformFailure(val platform: String, val reason: String, val count: Long)

@Serializable
data class ChannelsSection(val ok: Boolean, val data: List<ChannelRow>? = null, val message: String? = null)

@Serializable
data class VisitorBreakdownSection(
    val ok: Boolean,
    val data: VisitorBreakdownData? = null,
    val message: String? = null,
)

@Serializable
data class VisitorBreakdownData(
    val deviceTypes: List<VisitorBreakdownRow> = emptyList(),
    val operatingSystems: List<VisitorBreakdownRow> = emptyList(),
)

@Serializable
data class VisitorBreakdownRow(
    val label: String,
    val visitors: Long,
    val pctVisitors: Double = 0.0,
)

@Serializable
data class BlogPostsSection(val ok: Boolean, val data: List<BlogPostRow>? = null, val message: String? = null)

// One blog post's last 90 days. The linked* counts are people who read the post first or clicked
// its CTA before converting; a hybrid "a → b" reader counts under both posts. The unprefixed
// conversion counts (attributed, paired, ...) are first-read only and never overlap.
@Serializable
data class BlogPostRow(
    val slug: String,
    val views: Long = 0,
    val views7d: Long = 0,
    val visitors: Long = 0,
    val entrances: Long = 0,
    val ctaClickers: Long = 0,
    val attributed: Long = 0,
    val downloaded: Long = 0,
    val installed: Long = 0,
    val paired: Long = 0,
    val activated: Long = 0,
    val trials: Long = 0,
    val paid: Long = 0,
    val linked: Long = 0,
    val linkedDownloaded: Long = 0,
    val linkedPaired: Long = 0,
    val linkedTrials: Long = 0,
    val linkedPaid: Long = 0,
)

@Serializable
data class TrailSection(val ok: Boolean, val data: TrailData? = null, val message: String? = null)

// Each person on three layers at once — source (outside world), blog, affiliate — plus whole
// journeys like "chatgpt → attention-armor (blog) → maya (affiliate)". All time. Rows arrive
// ordered by what's paying now.
@Serializable
data class TrailData(
    val sources: List<TrailRow> = emptyList(),
    val blog: List<TrailRow> = emptyList(),
    val affiliates: List<TrailRow> = emptyList(),
    val journeys: List<TrailRow> = emptyList(),
)

@Serializable
data class TrailRow(
    val channel: String,
    val kind: String = "",
    val people: Long = 0,
    val people30d: Long = 0,
    val downloaded: Long = 0,
    val paired: Long = 0,
    val trials: Long = 0,
    val paid: Long = 0,
    val lifetime: Long = 0,
    val activeTrials: Long = 0,
    val activeSubs: Long = 0,
)

@Serializable
data class PmfSection(val ok: Boolean, val data: PmfData? = null, val message: String? = null)

// Sean Ellis PMF survey ("how would you feel if you could no longer use Talysman?").
// pctVeryDisappointed is the actual PMF number — 40% is the classic threshold.
@Serializable
data class PmfData(
    val responses: Long,
    val pctVeryDisappointed: Int? = null,
    val pctSomewhatDisappointed: Int? = null,
    val pctNotDisappointed: Int? = null,
)

// Mirrors GET /api/analytics/errors (apps/web/src/app/api/analytics/errors/route.ts).
@Serializable
data class ErrorReport(
    val event: String,
    val platform: String? = null,
    val appVersion: String? = null,
    val deviceId: String? = null,
    val occurredAt: String,
    val receivedAt: String,
    val message: String,
    val stack: String? = null,
    val account: ErrorAccount? = null,
)

@Serializable
data class ErrorAccount(
    val email: String,
    val name: String? = null,
)

@Serializable
data class ChannelRow(
    val channel: String,
    val medium: String,
    val visitors: Long,
    val downloaded: Long? = null,
    val installed: Long? = null,
    val accounts: Long,
    // Defaulted so an APK built against this model still parses a server that predates it.
    val paired: Long? = null,
    val trials: Long,
    val paid: Long,
    val pctVisitorToPaid: Double = 0.0,
)
