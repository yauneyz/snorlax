---
title: "Talysman Browser Extension Privacy Policy"
---

_Last updated: July 21, 2026_

This policy applies to the Talysman extensions for Google Chrome and Mozilla Firefox. The
extension is a local companion to the Talysman desktop application. A separate
[Microsoft Edge extension policy](/edge-extension-privacy) is available for the Edge listing.

## What the extension does

The extension receives the current focus status, blocking mode, and the domain list configured by
the user in the locally installed Talysman desktop application. It converts that configuration
into browser-managed block, allow, and redirect rules. When a top-level website navigation is
denied, the browser redirects it to a fixed page packaged in the extension stating that Talysman
blocked the website. The fixed page does not receive or display the attempted URL.

The browser evaluates those rules internally. The extension does not receive, read, or record the
URLs a user visits, browsing history, page content, search terms, cookies, form data, or request
contents.

## Data collection and transmission

The extension does not collect or transmit personal information, browsing activity, analytics,
telemetry, or advertising data to Talysman or to any third party. It contains no advertising or
analytics SDKs and makes no Internet requests.

The extension sends one fixed `hello` control message to the Talysman native messaging host on the
same computer. The local companion responds with the blocking configuration described above. This
local communication is used only to provide the extension's website-blocking function.

Talysman does not sell extension data, use it for advertising, allow humans to read it, or transfer
it to third parties. Any use of information received from browser APIs is limited to providing the
extension's disclosed website-blocking purpose and complies with the Chrome Web Store User Data
Policy, including its Limited Use requirements.

## Local storage and retention

The extension does not use browser storage. The browser stores its dynamic blocking rules locally
so they survive a background-worker or browser restart. Rules are replaced when the Talysman
configuration changes and are removed automatically when the extension is uninstalled. If the
desktop companion disconnects, the last applied rules remain until it reconnects or the user
disables or removes the extension.

The Talysman desktop application separately stores the domain list the user configured. Users can
change or delete that configuration in the desktop application.

## Permissions

- `declarativeNetRequest` lets the browser apply the configured block, allow, and redirect rules
  without exposing individual requests to the extension.
- `nativeMessaging` lets the extension exchange blocking state with the locally installed
  Talysman desktop companion.
- `<all_urls>` host access lets the browser redirect a denied top-level website navigation to the
  fixed page packaged in the extension. Chrome and Firefox require host access for declarative
  redirect rules. The extension has no content scripts, does not use browsing-history or tab APIs,
  and is not notified when an individual rule matches.

The host permission is used only by browser-evaluated declarative rules. The extension does not use
it to read page content or receive individual browsing requests.

## User control

Users choose whether to install the extension from the browser's official store and can disable or
remove it through the browser's standard extension controls. Disabling or removing the extension
stops browser-level blocking. Removing the desktop application removes the native messaging host.

## Security

The native messaging registration permits only the official Talysman extension IDs to launch the
local host. The extension contains all executable code in its reviewed store package and does not
download or execute remote code.

## Changes and contact

We will update this page and its date before materially changing the extension's data practices.
Questions or privacy requests can be sent to [support@talysman.app](mailto:support@talysman.app).
