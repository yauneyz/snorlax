#!/bin/sh
set -eu

systemctl disable --now talysman >/dev/null 2>&1 || true
rm -f /etc/systemd/system/talysman.service
systemctl daemon-reload >/dev/null 2>&1 || true
nft delete table inet talysman >/dev/null 2>&1 || true
# Mirrors dns::remove_include() in native/linux/src/enforce/dns.rs, which this script cannot call
# directly: by the time postrm runs, dpkg has already removed the packaged svcctl binary. Left in
# place, this include survives apt purge and points dnsmasq at a conf-file under /run that never
# exists post-reboot.
rm -f /etc/dnsmasq.d/talysman.conf
systemctl reload dnsmasq >/dev/null 2>&1 || pkill -HUP dnsmasq >/dev/null 2>&1 || true
rm -f /etc/opt/chrome/native-messaging-hosts/com.talysman.host.json
rm -f /etc/opt/chrome_for_testing/native-messaging-hosts/com.talysman.host.json
rm -f /etc/chromium/native-messaging-hosts/com.talysman.host.json
rm -f /etc/opt/edge/native-messaging-hosts/com.talysman.host.json
rm -f /etc/brave/native-messaging-hosts/com.talysman.host.json
rm -f /etc/opt/vivaldi/native-messaging-hosts/com.talysman.host.json
rm -f /etc/opt/opera/native-messaging-hosts/com.talysman.host.json
rm -f /usr/lib/mozilla/native-messaging-hosts/com.talysman.host.json

# Best-effort app_uninstalled (architecture §7-8/Phase 8). Electron's userData is per-user
# (~/.config/Talysman), and this postrm hook runs system-wide as root with no reliable way to
# know which user account(s) ran the app, so scan every home directory for a device-id.json the
# desktop app wrote on first run. No API_BASE_URL is available here (that's baked into the
# Electron bundle at build time, not exported to shell) — packaged public builds always point at
# production, so the URL is hardcoded. Never let this block fail the uninstall.
{
  for device_id_file in /home/*/.config/Talysman/device-id.json /root/.config/Talysman/device-id.json; do
    [ -f "$device_id_file" ] || continue
    device_id=$(grep -o '"deviceId"[[:space:]]*:[[:space:]]*"[^"]*"' "$device_id_file" | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/' || true)
    installed_at=$(grep -o '"installedAt"[[:space:]]*:[[:space:]]*"[^"]*"' "$device_id_file" | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/' || true)
    [ -n "${device_id:-}" ] || continue

    days_installed=""
    if [ -n "${installed_at:-}" ] && command -v date >/dev/null 2>&1; then
      installed_epoch=$(date -d "$installed_at" +%s 2>/dev/null || true)
      now_epoch=$(date +%s 2>/dev/null || true)
      if [ -n "${installed_epoch:-}" ] && [ -n "${now_epoch:-}" ]; then
        days_installed=$(( (now_epoch - installed_epoch) / 86400 ))
      fi
    fi

    if command -v curl >/dev/null 2>&1; then
      occurred_at=$(date -u +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || echo "")
      body="{\"event\":\"app_uninstalled\",\"source\":\"desktop\",\"device_id\":\"$device_id\",\"occurred_at\":\"$occurred_at\",\"platform\":\"linux\",\"props\":{\"platform\":\"linux\",\"days_installed\":${days_installed:-0}}}"
      curl -fsS -m 3 -X POST -H 'Content-Type: application/json' -d "$body" \
        https://www.talysman.app/api/analytics/track >/dev/null 2>&1 || true
    fi
  done
} || true
