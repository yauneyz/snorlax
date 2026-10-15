#!/bin/sh
set -eu

# rpm runs the OLD package's postun scriptlet after the new package is installed, with $1 >= 1 --
# tearing down here would delete the unit the new package's post scriptlet just installed.
# (deb's postrm "upgrade" runs before the new postinst, which reinstalls everything, so deb keeps
# the teardown.)
case "${1:-}" in
  '' | 0 | *[!0-9]*) ;;
  *) exit 0 ;;
esac

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

# Undo after-install.sh's Electron housekeeping, unless this is a deb upgrade whose new postinst
# is about to recreate it.
if [ "${1:-}" != "upgrade" ]; then
  rm -f /usr/bin/talysman
  if [ -f /etc/apparmor.d/talysman ]; then
    apparmor_parser --remove /etc/apparmor.d/talysman >/dev/null 2>&1 || true
    rm -f /etc/apparmor.d/talysman
  fi
fi

# Best-effort app_uninstalled (architecture §7-8/Phase 8). Electron's userData is per-user
# (~/.config/Talysman), and this postrm hook runs system-wide as root with no reliable way to
# know which user account(s) ran the app, so scan every home directory for a device-id.json the
# desktop app wrote on first run. No API_BASE_URL is available here (that's baked into the
# Electron bundle at build time, not exported to shell) — packaged public builds always point at
# production, so the URL is hardcoded. Never let this block fail the uninstall, and never report
# a deb upgrade (postrm "upgrade") as an uninstall.
#
# This file must contain no literal percent sign: rpmbuild expands rpm macros (percent + name)
# inside scriptlets, and a date format's seconds field fails the build outright. The formats are
# built from octal escapes instead. (Nor any brace-wrapped bare variable name: electron-builder
# substitutes those as its own template macros and fails on unknown ones.)
epoch_format=$(printf '+\045s')
iso_format=$(printf '+\045Y-\045m-\045dT\045H:\045M:\045S.000Z')
[ "${1:-}" = "upgrade" ] || {
  for device_id_file in /home/*/.config/Talysman/device-id.json /root/.config/Talysman/device-id.json; do
    [ -f "$device_id_file" ] || continue
    device_id=$(grep -o '"deviceId"[[:space:]]*:[[:space:]]*"[^"]*"' "$device_id_file" | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/' || true)
    installed_at=$(grep -o '"installedAt"[[:space:]]*:[[:space:]]*"[^"]*"' "$device_id_file" | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/' || true)
    [ -n "${device_id:-}" ] || continue

    days_installed=""
    if [ -n "${installed_at:-}" ] && command -v date >/dev/null 2>&1; then
      installed_epoch=$(date -d "$installed_at" "$epoch_format" 2>/dev/null || true)
      now_epoch=$(date "$epoch_format" 2>/dev/null || true)
      if [ -n "${installed_epoch:-}" ] && [ -n "${now_epoch:-}" ]; then
        days_installed=$(( (now_epoch - installed_epoch) / 86400 ))
      fi
    fi

    if command -v curl >/dev/null 2>&1; then
      occurred_at=$(date -u "$iso_format" 2>/dev/null || echo "")
      body="{\"event\":\"app_uninstalled\",\"source\":\"desktop\",\"device_id\":\"$device_id\",\"occurred_at\":\"$occurred_at\",\"platform\":\"linux\",\"props\":{\"platform\":\"linux\",\"days_installed\":${days_installed:-0}}}"
      curl -fsS -m 3 -X POST -H 'Content-Type: application/json' -d "$body" \
        https://www.talysman.app/api/analytics/track >/dev/null 2>&1 || true
    fi
  done
} || true
