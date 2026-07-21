#!/bin/sh
set -eu

systemctl disable --now talysman >/dev/null 2>&1 || true
rm -f /etc/systemd/system/talysman.service
systemctl daemon-reload >/dev/null 2>&1 || true
nft delete table inet talysman >/dev/null 2>&1 || true
rm -f /etc/opt/chrome/native-messaging-hosts/com.talysman.host.json
rm -f /etc/opt/chrome_for_testing/native-messaging-hosts/com.talysman.host.json
rm -f /etc/chromium/native-messaging-hosts/com.talysman.host.json
rm -f /etc/opt/edge/native-messaging-hosts/com.talysman.host.json
rm -f /usr/lib/mozilla/native-messaging-hosts/com.talysman.host.json
