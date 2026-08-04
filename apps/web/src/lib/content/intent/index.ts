import { blockerForPeopleWhoBypassBlockers } from "./blocker-for-people-who-bypass-blockers";
import { brickForDesktop } from "./brick-for-desktop";
import { coldTurkeyAlternative } from "./cold-turkey-alternative";
import { freedomAlternativeForDesktop } from "./freedom-alternative-for-desktop";
import { howToStopDisablingWebsiteBlockers } from "./how-to-stop-disabling-website-blockers";
import { physicalWebsiteBlocker } from "./physical-website-blocker";
import { turnAUsbDriveIntoADistractionBlocker } from "./turn-a-usb-drive-into-a-distraction-blocker";
import { websiteBlockerYouCantDisable } from "./website-blocker-you-cant-disable";
import { youtubeBlockerForDesktop } from "./youtube-blocker-for-desktop";
import type { IntentPage } from "./types";

export type { IntentPage, IntentSection } from "./types";

/**
 * The high-intent search pages, served at the site root (`/physical-website-blocker`).
 *
 * Order is the order they appear in the sitemap and in each other's "related" fallbacks —
 * roughly broadest intent first.
 */
export const intentPages: IntentPage[] = [
  physicalWebsiteBlocker,
  websiteBlockerYouCantDisable,
  blockerForPeopleWhoBypassBlockers,
  youtubeBlockerForDesktop,
  brickForDesktop,
  coldTurkeyAlternative,
  freedomAlternativeForDesktop,
  howToStopDisablingWebsiteBlockers,
  turnAUsbDriveIntoADistractionBlocker,
];

const bySlug = new Map(intentPages.map((page) => [page.slug, page]));

export function getIntentPage(slug: string): IntentPage | null {
  return bySlug.get(slug) ?? null;
}

/** Resolves a page's `related` slugs, silently dropping any that no longer exist. */
export function relatedIntentPages(page: IntentPage): IntentPage[] {
  return page.related
    .map((slug) => bySlug.get(slug))
    .filter((related): related is IntentPage => related !== undefined && related.slug !== page.slug);
}
