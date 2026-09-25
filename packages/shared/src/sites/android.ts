/**
 * Android-only catalog data for Talysman for Android: which browsers it can read addresses from,
 * and which system screens it guards while blocking is on. Like the site catalog, this is the
 * only place specific apps are named — the Kotlin accessibility service is generic.
 * `pnpm generate:sites` writes it to apps/android/blocker/catalog/android-catalog.json.
 */
import type { AndroidBrowser, AndroidGuard } from './types.js';

export const ANDROID_BROWSERS: readonly AndroidBrowser[] = [
  { package: 'com.android.chrome', label: 'Chrome', urlBarIds: ['com.android.chrome:id/url_bar'] },
  { package: 'com.chrome.beta', label: 'Chrome Beta', urlBarIds: ['com.chrome.beta:id/url_bar'] },
  { package: 'com.chrome.dev', label: 'Chrome Dev', urlBarIds: ['com.chrome.dev:id/url_bar'] },
  { package: 'com.chrome.canary', label: 'Chrome Canary', urlBarIds: ['com.chrome.canary:id/url_bar'] },
  { package: 'com.microsoft.emmx', label: 'Edge', urlBarIds: ['com.microsoft.emmx:id/url_bar'] },
  { package: 'com.brave.browser', label: 'Brave', urlBarIds: ['com.brave.browser:id/url_bar'] },
  { package: 'com.vivaldi.browser', label: 'Vivaldi', urlBarIds: ['com.vivaldi.browser:id/url_bar'] },
  { package: 'com.kiwibrowser.browser', label: 'Kiwi', urlBarIds: ['com.kiwibrowser.browser:id/url_bar'] },
  {
    package: 'com.sec.android.app.sbrowser',
    label: 'Samsung Internet',
    urlBarIds: ['com.sec.android.app.sbrowser:id/location_bar_edit_text', 'com.sec.android.app.sbrowser:id/custom_tab_toolbar_url_bar_text'],
  },
  { package: 'com.opera.browser', label: 'Opera', urlBarIds: ['com.opera.browser:id/url_field'] },
  {
    package: 'com.duckduckgo.mobile.android',
    label: 'DuckDuckGo',
    urlBarIds: ['com.duckduckgo.mobile.android:id/omnibarTextInput'],
  },
  {
    package: 'org.mozilla.firefox',
    label: 'Firefox',
    urlBarIds: ['org.mozilla.firefox:id/mozac_browser_toolbar_url_view'],
    extensionCapable: true,
  },
  {
    package: 'org.mozilla.firefox_beta',
    label: 'Firefox Beta',
    urlBarIds: ['org.mozilla.firefox_beta:id/mozac_browser_toolbar_url_view'],
    extensionCapable: true,
  },
  {
    package: 'org.mozilla.fenix',
    label: 'Firefox Nightly',
    urlBarIds: ['org.mozilla.fenix:id/mozac_browser_toolbar_url_view'],
    extensionCapable: true,
  },
];

const SETTINGS = ['com.android.settings', 'com.samsung.android.settings', 'com.google.android.permissioncontroller'];

export const ANDROID_GUARDS: readonly AndroidGuard[] = [
  {
    id: 'app-info',
    label: 'Talysman’s app info',
    packages: SETTINGS,
    match: [{ text: '^Talysman$' }, { text: '(?i)^(force stop|uninstall|clear storage|clear data)$' }],
  },
  {
    id: 'accessibility',
    label: 'Talysman’s accessibility switch',
    packages: SETTINGS,
    match: [{ text: '(?i)^(use talysman|talysman shortcut)$' }],
  },
  {
    id: 'device-admin',
    label: 'Talysman’s device admin',
    packages: SETTINGS,
    match: [{ text: '(?i)deactivate this device admin' }, { text: 'Talysman' }],
  },
  {
    id: 'uninstall',
    label: 'Uninstalling Talysman',
    packages: ['com.google.android.packageinstaller', 'com.android.packageinstaller'],
    match: [{ text: 'Talysman' }],
  },
  {
    id: 'date-time',
    label: 'Date & time',
    packages: SETTINGS,
    match: [{ text: '(?i)^(set time automatically|automatic date (and|&) time|use network-provided time)$' }],
  },
];
