import { appBlockerPc } from "./app-blocker-pc";
import { blockRedditWhileWorking } from "./block-reddit-while-working";
import { blockSocialMediaOnComputer } from "./block-social-media-on-computer";
import { blockYoutubeWhileWorking } from "./block-youtube-while-working";
import { blockerForPeopleWhoBypassBlockers } from "./blocker-for-people-who-bypass-blockers";
import { brickForComputer } from "./brick-for-computer";
import { coldTurkeyAlternative } from "./cold-turkey-alternative";
import { coldTurkeyVsFreedomVsFocusme } from "./cold-turkey-vs-freedom-vs-focusme";
import { deepWorkBlocker } from "./deep-work-blocker";
import { digitalLockVsPhysicalFriction } from "./digital-lock-vs-physical-friction";
import { focusAppDevelopers } from "./focus-app-developers";
import { focusAppRemoteWork } from "./focus-app-remote-work";
import { focusAppWriters } from "./focus-app-writers";
import { focusmeAlternative } from "./focusme-alternative";
import { freedomAlternative } from "./freedom-alternative";
import { physicalWebsiteBlocker } from "./physical-website-blocker";
import { stopDisablingWebsiteBlocker } from "./stop-disabling-website-blocker";
import { turnAUsbDriveIntoADistractionBlocker } from "./turn-a-usb-drive-into-a-distraction-blocker";
import { websiteBlockerLinux } from "./website-blocker-linux";
import { websiteBlockerMac } from "./website-blocker-mac";
import { websiteBlockerWindows } from "./website-blocker-windows";
import { websiteBlockerYouCantTurnOff } from "./website-blocker-you-cant-turn-off";
import type { IntentGroup, IntentPage } from "./types";

export type { IntentGroup, IntentPage, IntentSection } from "./types";

/**
 * The high-intent search pages, served at the site root (`/physical-website-blocker`).
 *
 * Order is the order they appear in the sitemap and the footer — roughly publication priority
 * within each group.
 */
export const intentPages: IntentPage[] = [
  // compare
  coldTurkeyAlternative,
  brickForComputer,
  freedomAlternative,
  focusmeAlternative,
  coldTurkeyVsFreedomVsFocusme,
  digitalLockVsPhysicalFriction,
  // guides
  physicalWebsiteBlocker,
  stopDisablingWebsiteBlocker,
  blockRedditWhileWorking,
  blockYoutubeWhileWorking,
  blockSocialMediaOnComputer,
  turnAUsbDriveIntoADistractionBlocker,
  // use cases
  websiteBlockerYouCantTurnOff,
  websiteBlockerWindows,
  websiteBlockerMac,
  websiteBlockerLinux,
  appBlockerPc,
  deepWorkBlocker,
  blockerForPeopleWhoBypassBlockers,
  focusAppDevelopers,
  focusAppWriters,
  focusAppRemoteWork,
];

export const GROUP_LABELS: Record<IntentGroup, string> = {
  compare: "Compare",
  guides: "Guides",
  "use-cases": "Use cases",
};

export function pagesInGroup(group: IntentGroup): IntentPage[] {
  return intentPages.filter((page) => page.group === group);
}

const bySlug = new Map(intentPages.map((page) => [page.slug, page]));

export function getIntentPage(slug: string): IntentPage | null {
  return bySlug.get(slug) ?? null;
}

/**
 * The download link for a search page's CTAs. `from` is carried through /download to the
 * installer redirect, so `download_clicked` records which page earned it (analytics_landing_funnel).
 */
export function downloadHref(slug: string): string {
  return `/download?from=${slug}`;
}

/** A `from` value from a query string, kept only when it names a live search page. */
export function downloadSource(value: string | null | undefined): string | null {
  return value && bySlug.has(value) ? value : null;
}

/** Resolves a page's `related` slugs, silently dropping any that no longer exist. */
export function relatedIntentPages(page: IntentPage): IntentPage[] {
  return page.related
    .map((slug) => bySlug.get(slug))
    .filter((related): related is IntentPage => related !== undefined && related.slug !== page.slug);
}
