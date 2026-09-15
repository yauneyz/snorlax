#!/bin/sh
set -eu

find_svcctl() {
  for dir in /opt/Talysman /opt/talysman /opt/Talysman-* /opt/talysman-*; do
    if [ -x "$dir/resources/bin/talysman-svcctl" ]; then
      printf '%s\n' "$dir/resources/bin/talysman-svcctl"
      return 0
    fi
  done
  return 1
}

svcctl="$(find_svcctl)" || {
  echo "Talysman service control binary not found; service was not installed." >&2
  exit 1
}

"$svcctl" install

# Premade blocklists are sinkholed via dnsmasq (svcctl install just wrote its
# talysman.conf include); the dnsmasq package dependency only guarantees it's
# installed, not enabled, so make sure it's actually running.
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now dnsmasq >/dev/null 2>&1 || true
fi
