#!/bin/sh
set -eu

for dir in /opt/Talysman /opt/talysman /opt/Talysman-* /opt/talysman-*; do
  if [ -x "$dir/resources/bin/talysman-svcctl" ]; then
    "$dir/resources/bin/talysman-svcctl" guard-uninstall
    exit 0
  fi
done
