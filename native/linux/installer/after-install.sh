#!/bin/sh
# Shared post-install (and pacman post-upgrade) hook for the deb, rpm and pacman packages.
#
# Setting afterInstall in electron-builder.yml replaces electron-builder's own template, so the
# Electron housekeeping that template did lives here too. Without the chrome-sandbox/AppArmor
# half, Electron aborts at launch on Ubuntu 24.04+ (unprivileged user namespaces are restricted
# by AppArmor) -- the app installs but never opens.
set -eu

app_dir=""
for dir in /opt/Talysman /opt/talysman /opt/Talysman-* /opt/talysman-*; do
  if [ -x "$dir/resources/bin/talysman-svcctl" ]; then
    app_dir="$dir"
    break
  fi
done
if [ -z "$app_dir" ]; then
  echo "Talysman service control binary not found; service was not installed." >&2
  exit 1
fi

# --- Electron housekeeping (mirrors app-builder-lib/templates/linux/after-install.tpl) -------
ln -sf "$app_dir/talysman" /usr/bin/talysman || true

# The SUID helper is only needed where unprivileged user namespaces don't work. `unshare` is
# util-linux, present on every distro we package for; if it's missing, fall back to SUID.
if command -v unshare >/dev/null 2>&1 && unshare --user true >/dev/null 2>&1; then
  chmod 0755 "$app_dir/chrome-sandbox" || true
else
  chmod 4755 "$app_dir/chrome-sandbox" || true
fi

# Ubuntu 24.04+: grant the app the userns permission its AppArmor policy otherwise denies. The
# dry-run parse skips older AppArmor (22.04) that cannot read the abi/4.0 profile.
if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
  profile_src="$app_dir/resources/apparmor-profile"
  if [ -f "$profile_src" ] && apparmor_parser --skip-kernel-load --debug "$profile_src" >/dev/null 2>&1; then
    cp -f "$profile_src" /etc/apparmor.d/talysman
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
      apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/talysman || true
    fi
  fi
fi

if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database /usr/share/mime || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi

# --- Privileged service ---------------------------------------------------------------------
# Also the upgrade path: svcctl install restarts an existing unit onto the new binary.
"$app_dir/resources/bin/talysman-svcctl" install

# Premade blocklists are sinkholed via dnsmasq (svcctl install just wrote its
# talysman.conf include); the dnsmasq package dependency only guarantees it's
# installed, not enabled, so make sure it's actually running.
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now dnsmasq >/dev/null 2>&1 || true
fi
