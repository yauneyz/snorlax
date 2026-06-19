#!/bin/sh
set -eu

find_svcctl() {
  for dir in /opt/FocusLock /opt/focuslock /opt/FocusLock-* /opt/focuslock-*; do
    if [ -x "$dir/resources/bin/focuslock-svcctl" ]; then
      printf '%s\n' "$dir/resources/bin/focuslock-svcctl"
      return 0
    fi
  done
  return 1
}

svcctl="$(find_svcctl)" || {
  echo "FocusLock service control binary not found; service was not installed." >&2
  exit 1
}

"$svcctl" install
