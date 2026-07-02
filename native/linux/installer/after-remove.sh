#!/bin/sh
set -eu

systemctl disable --now talysman >/dev/null 2>&1 || true
rm -f /etc/systemd/system/talysman.service
systemctl daemon-reload >/dev/null 2>&1 || true
nft delete table inet talysman >/dev/null 2>&1 || true
