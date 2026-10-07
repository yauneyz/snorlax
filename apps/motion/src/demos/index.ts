import { appBlockerPc } from './app-blocker-pc';
import { blockRedditWhileWorking } from './block-reddit-while-working';
import { blockSocialMediaOnComputer } from './block-social-media-on-computer';
import { blockYoutubeWhileWorking } from './block-youtube-while-working';
import { blockerForPeopleWhoBypassBlockers } from './blocker-for-people-who-bypass-blockers';
import { brickForComputer } from './brick-for-computer';
import { coldTurkeyAlternative } from './cold-turkey-alternative';
import { coldTurkeyVsFreedomVsFocusme } from './cold-turkey-vs-freedom-vs-focusme';
import { deepWorkBlocker } from './deep-work-blocker';
import { digitalLockVsPhysicalFriction } from './digital-lock-vs-physical-friction';
import { focusAppDevelopers } from './focus-app-developers';
import { focusAppRemoteWork } from './focus-app-remote-work';
import { focusAppWriters } from './focus-app-writers';
import { focusmeAlternative } from './focusme-alternative';
import { freedomAlternative } from './freedom-alternative';
import { physicalWebsiteBlocker } from './physical-website-blocker';
import { stopDisablingWebsiteBlocker } from './stop-disabling-website-blocker';
import { turnAUsbDriveIntoADistractionBlocker } from './turn-a-usb-drive-into-a-distraction-blocker';
import { websiteBlockerLinux } from './website-blocker-linux';
import { websiteBlockerMac } from './website-blocker-mac';
import { websiteBlockerWindows } from './website-blocker-windows';
import { websiteBlockerYouCantTurnOff } from './website-blocker-you-cant-turn-off';
import type { Demo } from './types';

export type { Demo } from './types';

/**
 * One motion demo per search page (apps/web/src/lib/content/intent), in the pages' order. The
 * web app's tests check every page has one.
 */
export const DEMOS: Demo[] = [
  coldTurkeyAlternative,
  brickForComputer,
  freedomAlternative,
  focusmeAlternative,
  coldTurkeyVsFreedomVsFocusme,
  digitalLockVsPhysicalFriction,
  physicalWebsiteBlocker,
  stopDisablingWebsiteBlocker,
  blockRedditWhileWorking,
  blockYoutubeWhileWorking,
  blockSocialMediaOnComputer,
  turnAUsbDriveIntoADistractionBlocker,
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
