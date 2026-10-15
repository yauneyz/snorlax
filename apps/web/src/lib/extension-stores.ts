import { config } from "@/lib/config";

/**
 * Published listings are the defaults; deployment config can override them if a listing moves.
 */
const storeUrls = {
  chrome: "https://chromewebstore.google.com/detail/talysman/jblidbjafmpbpednomngbbmpkihedeko",
  firefox: "https://addons.mozilla.org/en-US/firefox/addon/talysman/",
} as const;

/** The browser-extension cards shown on /download and /welcome. */
export const extensionTargets = [
  {
    platform: "chrome",
    name: "Chrome",
    note: "Chrome Web Store",
    href: config.extensionStores.chromeUrl || storeUrls.chrome,
    external: true,
  },
  {
    platform: "firefox",
    name: "Firefox",
    note: "Firefox Browser Add-ons",
    href: config.extensionStores.firefoxUrl || storeUrls.firefox,
    external: true,
  },
] as const;
