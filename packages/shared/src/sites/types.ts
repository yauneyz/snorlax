/**
 * Site catalog schema. Each supported site is one declarative module (see `./sites/*.ts` and
 * `./README.md`). A site decomposes itself into **features** — its own vocabulary of things a
 * user may want on or off (feed, recommendations, messages, …) — and maps every URL and every
 * piece of page chrome onto one of those features. Enforcement code never special-cases a site:
 * the extension, the daemon, and the desktop UI are all driven from this data.
 *
 * Site rules never block a page. Every page of a ruled site stays reachable; a feature whose
 * action is `block` is *hidden* — its `elements` are removed from whatever page they appear on.
 *
 * `scripts/generate-site-catalog.ts` validates the catalog and emits the runtime artifacts
 * (extension data module, native JSON subset, content-script match patterns).
 */

/**
 * What a rule decides for a feature. On a site rule, `block` hides the feature's elements (the
 * page itself always loads). `judge` hands the decision to the AI judge (the user's tasks and
 * "help me avoid" list) page by page — a `block` verdict hides the page's feature as if it were
 * blocked; it resolves to `JudgePolicy.fallback` when the judge is unavailable.
 */
export type RuleAction = 'allow' | 'judge' | 'block';

export interface SiteFeature {
  /** Stable id, unique within the site. Persisted in user policies — never rename. */
  id: string;
  label: string;
  description?: string;
  /** Action applied when the user hasn't overridden this feature. */
  default: RuleAction;
  /** Always `default`; not user-configurable (e.g. sign-in flows). Hidden in the UI. */
  locked?: boolean;
}

export interface SiteRoute {
  /** Feature that owns URLs matching this route. */
  feature: string;
  /**
   * Hostname (exact, lowercase) this route is restricted to. Omitted ⇒ any of the site's
   * `appHosts`. Must itself be listed in `appHosts`.
   */
  host?: string;
  /**
   * RE2-compatible regex over the lowercased pathname with trailing slashes removed (`/` for the
   * root). Anchored by the author. Omitted ⇒ any path.
   */
  path?: string;
  /** Required query parameters, each an RE2-compatible regex over the raw (decoded) value. */
  query?: Record<string, string>;
  /** Hints for the AI judge when this page is judged. */
  judge?: { contentSelector?: string };
}

export interface SiteElement {
  /**
   * Hidden while this feature's action is `block`, and on a page of this feature that the AI
   * judge rejected.
   */
  feature: string;
  /** CSS selector list. */
  selector: string;
  /** Only hide on pages whose route belongs to one of these features. Omitted ⇒ every page. */
  on?: string[];
}

export interface SiteDefinition {
  /** Stable id. Persisted in user policies — never rename. */
  id: string;
  label: string;
  /** Registrable domains whose pages this site owns (subdomains included). */
  hosts: string[];
  /**
   * Exact hostnames that serve the site's app. Any other subdomain of `hosts` is classified as
   * `fallbackFeature` without route matching.
   */
  appHosts: string[];
  /** Asset/CDN domains the site's pages need; allowed through for sub-resources only. */
  networkDomains: string[];
  /** This site's feature schema. */
  features: SiteFeature[];
  /** Ordered; first match wins. */
  routes: SiteRoute[];
  /** Feature for URLs no route matches (typically the feed / discovery surface). */
  fallbackFeature: string;
  /**
   * What hiding each feature removes. Every configurable feature that owns pages must hide
   * something on its own pages, so visiting one with the feature hidden never shows it.
   */
  elements: SiteElement[];
  /**
   * `[url, expectedFeature]` fixtures. The catalog test checks every one against the engine and
   * against the compiled DNR rules, so they double as the site's regression suite.
   */
  examples: [url: string, feature: string][];
}

/** A user's configuration for one catalog site. Omitted features use the catalog default. */
export interface SiteRule {
  features: Partial<Record<string, RuleAction>>;
}

export function defineSite(site: SiteDefinition): SiteDefinition {
  return site;
}

const ACTION_RANK: Record<RuleAction, number> = { allow: 0, judge: 1, block: 2 };

/** allow < judge < block. */
export function actionRank(action: RuleAction): number {
  return ACTION_RANK[action];
}
