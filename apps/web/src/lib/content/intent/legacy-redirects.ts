/**
 * Intent pages whose slug changed to match the query it targets, old → new. `next.config.ts`
 * turns these into permanent redirects so links and rankings earned at the old URLs follow.
 * Dependency-free on purpose: next.config loads it before the app (and its env validation)
 * exists. A unit test checks every target is a live page.
 */
export const LEGACY_INTENT_REDIRECTS: Record<string, string> = {
  "brick-for-desktop": "brick-for-computer",
  "website-blocker-you-cant-disable": "website-blocker-you-cant-turn-off",
  "freedom-alternative-for-desktop": "freedom-alternative",
  "how-to-stop-disabling-website-blockers": "stop-disabling-website-blocker",
  "youtube-blocker-for-desktop": "block-youtube-while-working",
};
