#!/bin/sh
set -eu

systemctl disable --now focuslock >/dev/null 2>&1 || true
rm -f /etc/systemd/system/focuslock.service
systemctl daemon-reload >/dev/null 2>&1 || true
nft delete table inet focuslock >/dev/null 2>&1 || true
