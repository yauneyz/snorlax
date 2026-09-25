// Chromium builds never talk to the Talysman Android app (Chrome for Android has no extensions),
// so they ship this stand-in instead of loopback-port.js and contain no network client at all.

export const LOOPBACK_URL = null;

export function isAndroidBrowser() {
  return false;
}

export function loopbackPort() {
  throw new Error('Loopback transport is Firefox-only');
}
