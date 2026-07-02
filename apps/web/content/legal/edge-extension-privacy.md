---
title: "Talysman for Microsoft Edge Privacy Policy"
---

_Last updated: July 1, 2026_

This policy applies only to the Talysman extension distributed through Microsoft Edge Add-ons.
The Edge extension is a local companion to the Talysman desktop application.

## What the Edge extension processes

The extension receives the current focus status, blocking mode, and the domain list configured by
the user in the locally installed Talysman desktop application. It converts that configuration
into Microsoft Edge request-blocking rules.

Microsoft Edge evaluates those rules internally. The extension does not receive, read, or record
the URLs a user visits, browsing history, page content, search terms, cookies, form data, or request
contents.

## Collection, use, and sharing

The extension does not collect or transmit personal information, browsing activity, analytics,
telemetry, or advertising data to Talysman or to any third party. It contains no advertising or
analytics SDKs and makes no Internet requests.

The extension sends one fixed `hello` control message to the Talysman native messaging host on the
same computer. The local companion responds with the blocking configuration described above. This
local communication is used only to provide the extension's disclosed website-blocking function.

Talysman does not sell, broker, share, or disclose Edge extension data, use it for advertising, or
permit human access to it.

## Local storage, access, and deletion

The extension does not use browser storage. Microsoft Edge stores its dynamic blocking rules
locally so they survive a background-worker or browser restart. Rules are replaced when the
Talysman configuration changes and are removed automatically when the extension is uninstalled.
If the desktop companion disconnects, the last applied rules remain until it reconnects or the user
disables or removes the extension.

The Talysman desktop application separately stores the domain list the user configured. Users can
view, change, or delete that configuration in the desktop application.

## Permissions

- `declarativeNetRequest` lets Microsoft Edge apply the configured block and allow rules without
  exposing individual requests to the extension.
- `nativeMessaging` lets the extension exchange blocking state with the locally installed
  Talysman desktop companion.

The extension requests no website host permissions.

## User controls

Users choose whether to install the extension from Microsoft Edge Add-ons and can disable or remove
it through Microsoft Edge's standard extension controls. Disabling or removing it stops
browser-level blocking. Removing the desktop application removes the native messaging host.

## Security

The native messaging registration permits only the official Talysman Edge extension ID to launch
the local host. The extension contains all executable code in its reviewed Edge Add-ons package and
does not download or execute remote code.

## Changes and contact

We will update this page and its date before materially changing the Edge extension's data
practices. Questions or privacy requests can be sent to
[support@talysman.app](mailto:support@talysman.app).
