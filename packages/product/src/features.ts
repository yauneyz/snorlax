/** Pro-only per-user daily cap on LLM judge calls, enforced by the web `judge` route. */
export const SMART_FILTER_DAILY_JUDGE_LIMIT = 500;

export type ProductEnvironment = 'development' | 'production';

/**
 * Rollout flags shared by the desktop client and web backend. Keeping the decision here prevents
 * a production UI from hiding a feature while its server-side implementation remains callable.
 */
export function productFeaturesForEnvironment(environment: ProductEnvironment) {
  void environment;
  return {
    smartFiltering: true,
  } as const;
}
