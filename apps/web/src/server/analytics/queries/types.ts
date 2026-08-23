export type PanelData<T> = { ok: true; rows: T } | { ok: false; message: string };

// Unified metric shapes. Both /insights (prod target) and the Android widget read these same
// fields — /insights (marketing audience) via fetchProdSummary(), /insights/dev via direct
// production-Supabase queries over analytics_dev_* views, and the widget via
// GET /api/analytics/summary, which is the source
// these types were modeled on (see apps/android/.../data/InsightsModels.kt for its mirror).

export interface FunnelMetrics {
  visitors: number;
  downloaded: number;
  installed: number;
  accounts: number;
  paired: number;
  activated: number;
  trials: number;
  paid: number;
  medianVisitToDownloadSeconds: number | null;
  medianInstallToValueSeconds: number | null;
}

export interface ActiveUsersMetrics {
  dauProtected: number;
  dauUi: number;
  mauProtected: number;
  installedBase30d: number;
  series: { date: string; dauProtected: number }[];
}

export interface EngagementMetrics {
  medianFocusMinutes: number;
  scheduledFocusHours: number;
  manualFocusHours: number;
  sessionsCompleted: number;
  sessionsAborted: number;
}

export interface EngagementSummary {
  activeUsers: ActiveUsersMetrics | null;
  engagement: EngagementMetrics | null;
}

export interface RevenueMetrics {
  activeSubscriptions: number;
  activeTrials: number;
  subscriptionsStarted: number;
  cancelIntents: number;
  subscriptionsEnded: number;
  paymentsFailed: number;
  refunds: number;
}

export interface RetentionCohortMetrics {
  cohortWeek: string;
  devices: number;
  d1Pct: number | null;
  d7Pct: number | null;
  d30Pct: number | null;
}

export interface PlatformHealthMetrics {
  platform: string;
  appInstalled: number;
  serviceInstalled: number;
  extensionConnected: number;
}

export interface PlatformFailureMetrics {
  platform: string;
  reason: string;
  count: number;
}

export interface InstallHealthMetrics {
  platforms: PlatformHealthMetrics[];
  failures: PlatformFailureMetrics[];
}

export interface ChannelMetrics {
  channel: string;
  medium: string;
  visitors: number;
  accounts: number;
  trials: number;
  paid: number;
  pctVisitorToPaid: number;
}
