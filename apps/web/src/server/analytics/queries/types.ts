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
  /** Paid and not set to cancel at period end. */
  activeSubscriptions: number;
  /** Trialing and not set to cancel at period end. */
  activeTrials: number;
  subscriptionsStarted: number;
  cancelIntents: number;
  subscriptionsEnded: number;
  paymentsFailed: number;
  refunds: number;
  /** Still entitled, but set to cancel at period end. Not counted as active. */
  cancelingSubscriptions: number;
  cancelingTrials: number;
  lifetimeCustomers: number;
  /** Monthly recurring revenue of active subscriptions, at list price (yearly / 12). */
  mrrCents: number;
}

/** One channel on one layer of the trail, all time (analytics_trail_outcomes, migration 0022). */
export interface TrailOutcomeMetrics {
  channel: string;
  /** Source kind (search, ai, social, referral, campaign, paid, direct, none); for blog
   * post / hybrid / none; for affiliate affiliate / none. */
  kind: string;
  people: number;
  people30d: number;
  downloaded: number;
  paired: number;
  trials: number;
  paid: number;
  lifetime: number;
  /** Right now, excluding cancel-at-period-end. */
  activeTrials: number;
  activeSubs: number;
}

export interface TrailMetrics {
  sources: TrailOutcomeMetrics[];
  blog: TrailOutcomeMetrics[];
  affiliates: TrailOutcomeMetrics[];
  /** Whole journeys ("chatgpt → attention-armor (blog) → maya (affiliate)"), busiest first. */
  journeys: TrailOutcomeMetrics[];
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
  downloaded: number;
  installed: number;
  accounts: number;
  paired: number;
  trials: number;
  paid: number;
  pctVisitorToPaid: number;
}

export interface LandingPageMetrics {
  /** First-touch landing path, e.g. `/cold-turkey-alternative`. */
  path: string;
  visitors: number;
  organicVisitors: number;
  downloaded: number;
  installed: number;
  activated: number;
  paid: number;
  /** Downloads started from this page's CTA (last touch), whatever page the person landed on. */
  ctaDownloads: number;
}

/** One blog post's last 90 days (analytics_blog_posts, migration 0021). */
export interface BlogPostMetrics {
  slug: string;
  views: number;
  views7d: number;
  /** Distinct readers. */
  visitors: number;
  /** People whose very first page on the site was this post. */
  entrances: number;
  /** Distinct people who clicked the post's CTA. */
  ctaClickers: number;
  /** People whose blog channel starts with this post (their first read before converting). */
  attributed: number;
  downloaded: number;
  installed: number;
  paired: number;
  activated: number;
  trials: number;
  paid: number;
  /**
   * People linked to the post: they read it first, or clicked its CTA, before converting. A hybrid
   * "a → b" reader is linked to both posts, so these overlap across posts; `attributed` never does.
   */
  linked: number;
  linkedDownloaded: number;
  linkedPaired: number;
  linkedTrials: number;
  linkedPaid: number;
}

export interface VisitorBreakdownMetric {
  label: string;
  visitors: number;
  pctVisitors: number;
}

export interface VisitorBreakdownMetrics {
  deviceTypes: VisitorBreakdownMetric[];
  operatingSystems: VisitorBreakdownMetric[];
}
