#!/bin/sh
# Installs the built .deb, verifies the service comes up, then removes it and asserts every
# artifact the postinst/prerm/postrm hooks are responsible for is actually gone. Counterpart to
# scripts/smoke-windows-uninstall.ps1 -- run this on a real (non-container) Linux VM with systemd,
# since it exercises real dpkg hooks, systemd, and nftables.
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
dist_dir="$repo_root/dist"

deb="$(ls -t "$dist_dir"/Talysman-*-amd64.deb 2>/dev/null | head -n1 || true)"
if [ -z "$deb" ]; then
  echo "No Linux installer was found in dist." >&2
  exit 1
fi

echo "Installing $(basename "$deb")..."
apt-get update -qq
apt-get install -y "./$deb"

echo "Waiting for talysman.service to become active..."
deadline=$(($(date +%s) + 30))
while ! systemctl is-active --quiet talysman; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "talysman.service did not reach 'active' within 30 seconds." >&2
    systemctl status --no-pager talysman || true
    exit 1
  fi
  sleep 0.5
done

if [ ! -f /etc/dnsmasq.d/talysman.conf ]; then
  echo "Install did not write the expected dnsmasq include." >&2
  exit 1
fi

echo "Removing talysman..."
apt-get remove -y talysman

echo "Verifying cleanup..."
fail=0

leftover_paths="
/etc/systemd/system/talysman.service
/etc/dnsmasq.d/talysman.conf
/etc/opt/chrome/native-messaging-hosts/com.talysman.host.json
/etc/opt/chrome_for_testing/native-messaging-hosts/com.talysman.host.json
/etc/chromium/native-messaging-hosts/com.talysman.host.json
/etc/opt/edge/native-messaging-hosts/com.talysman.host.json
/usr/lib/mozilla/native-messaging-hosts/com.talysman.host.json
"
for path in $leftover_paths; do
  if [ -e "$path" ]; then
    echo "Leftover file after uninstall: $path" >&2
    fail=1
  fi
done

if systemctl status talysman >/dev/null 2>&1; then
  echo "talysman.service is still registered with systemd after uninstall." >&2
  fail=1
fi

if nft list table inet talysman >/dev/null 2>&1; then
  echo "nftables table 'inet talysman' still exists after uninstall." >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "Linux install/uninstall smoke test passed."
