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
)

@Serializable
data class ChannelRow(
    val channel: String,
    val medium: String,
    val visitors: Long,
    val accounts: Long,
    val trials: Long,
    val paid: Long,
    val pctVisitorToPaid: Double = 0.0,
)
