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
 *
 * `RuleAction` and `SiteRule` (a user's configuration for one catalog site; omitted features use
 * the catalog default) are generated from the Rust engine.
 */
export type { RuleAction, SiteRule } from '../generated/index.js';
import type { RuleAction } from '../generated/index.js';

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
  /** The site's Android app(s), driven by the same features (see `AndroidAppDefinition`). */
  android?: AndroidAppDefinition;
}

/**
 * A catalog entry's Android app. The same `SiteRule` drives the website (extension) and the app
 * (the Talysman for Android accessibility service): each screen matcher maps a region of the app
 * onto one of the entry's feature ids. No Kotlin code names a specific app — this data is all
 * Android enforcement knows about one.
 */
export interface AndroidAppDefinition {
  /** Application ids, e.g. `com.google.android.youtube`. Unique across the catalog. */
  packages: string[];
  /** Screens/regions mapped to this entry's features. Evaluated only for blocked features. */
  screens?: AndroidScreenMatcher[];
}

/** One accessibility-node predicate; every given field must match. */
export interface AndroidNodeMatch {
  /** Fully-qualified view id, e.g. `com.google.android.youtube:id/reel_recycler`. */
  viewId?: string;
  /** Regex over the node's text. */
  text?: string;
  /** Regex over the node's content description. */
  contentDesc?: string;
  className?: string;
  /** Foreground activity class name (matched against the window, not the node). */
  activity?: string;
  selected?: boolean;
}

export interface AndroidScreenMatcher {
  feature: string;
  /** All-of: every match must be present in the active window. */
  match: AndroidNodeMatch[];
  /**
   * back — press Back; home — go to the launcher; overlay — cover the screen (or `hideNodes`)
   * with a "hidden by Talysman" card; clickAlternative — click `alternative` (e.g. switch to the
   * Subscriptions tab).
   */
  action: 'back' | 'home' | 'overlay' | 'clickAlternative';
  alternative?: AndroidNodeMatch;
  /** Only cover these nodes' bounds instead of the whole screen. */
  hideNodes?: AndroidNodeMatch[];
  /** App version the matcher was last verified against (shown when blocking may be degraded). */
  maxTested?: string;
}

export function defineSite(site: SiteDefinition): SiteDefinition {
  return site;
}

const ACTION_RANK: Record<RuleAction, number> = { allow: 0, judge: 1, block: 2 };

/** allow < judge < block. */
export function actionRank(action: RuleAction): number {
  return ACTION_RANK[action];
}
