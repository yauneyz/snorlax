#!/bin/sh
set -eu

for dir in /opt/FocusLock /opt/focuslock /opt/FocusLock-* /opt/focuslock-*; do
  if [ -x "$dir/resources/bin/focuslock-svcctl" ]; then
    "$dir/resources/bin/focuslock-svcctl" guard-uninstall
    exit 0
  fi
done
