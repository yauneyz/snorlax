#!/bin/sh
# Installs the built .rpm on Fedora and openSUSE and the .pacman on Arch, each in a throwaway
# container, to prove every declared dependency resolves on the distro it targets. A dependency
# name that doesn't exist (the classic fpm/pacman failure) makes the package uninstallable for
# everyone on that distro, and nothing else in CI would notice.
#
# Scriptlets are disabled: containers have no systemd, so the service hooks can't run here. The
# hooks themselves are exercised on a real systemd host by scripts/smoke-linux-uninstall.sh (deb).
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
dist_dir="$repo_root/dist"

rpm="$(ls -t "$dist_dir"/Talysman-*.rpm 2>/dev/null | head -n1 || true)"
pacman_pkg="$(ls -t "$dist_dir"/Talysman-*.pacman 2>/dev/null | head -n1 || true)"
if [ -z "$rpm" ] || [ -z "$pacman_pkg" ]; then
  echo "Expected both a .rpm and a .pacman in dist (found rpm='$rpm' pacman='$pacman_pkg')." >&2
  exit 1
fi

echo "Fedora: dnf install $(basename "$rpm")"
docker run --rm -v "$dist_dir:/dist:ro" fedora:latest \
  dnf install -y --setopt=tsflags=noscripts "/dist/$(basename "$rpm")"

# zypper can't skip scriptlets, so resolve without installing: --dry-run still fails on any
# dependency it can't satisfy.
echo "openSUSE Tumbleweed: zypper install --dry-run $(basename "$rpm")"
docker run --rm -v "$dist_dir:/dist:ro" opensuse/tumbleweed:latest \
  zypper --non-interactive install --allow-unsigned-rpm --no-recommends --dry-run \
  "/dist/$(basename "$rpm")"

echo "Arch: pacman -U $(basename "$pacman_pkg")"
docker run --rm -v "$dist_dir:/dist:ro" archlinux:latest \
  sh -c "pacman -Sy --noconfirm >/dev/null && pacman -U --noconfirm --noscriptlet '/dist/$(basename "$pacman_pkg")'"

echo "rpm and pacman packages install with all dependencies resolved."
