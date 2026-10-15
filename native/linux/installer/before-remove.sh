#!/bin/sh
set -eu

# rpm runs the OLD package's preun scriptlet after the new package's post on upgrade, with $1 >= 1.
# Nothing is torn down on an rpm upgrade (see after-remove.sh), so there is nothing to guard, and
# failing here would leave both versions registered in the rpm database. deb passes words
# ("upgrade" stays guarded: its postrm does tear down), pacman passes a version string, and an
# rpm erase passes 0 -- all of those fall through to the guard.
case "${1:-}" in
  '' | 0 | *[!0-9]*) ;;
  *) exit 0 ;;
esac

for dir in /opt/Talysman /opt/talysman /opt/Talysman-* /opt/talysman-*; do
  if [ -x "$dir/resources/bin/talysman-svcctl" ]; then
    "$dir/resources/bin/talysman-svcctl" guard-uninstall
    exit 0
  fi
done
