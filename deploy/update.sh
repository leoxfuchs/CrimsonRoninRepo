#!/usr/bin/env bash
# Pull the latest Crimson Ronin on the projects VM and restart it. The saved world lives outside the checkout.
set -euo pipefail
SRC=/srv/projects/crimson-ronin
BRANCH="${BRANCH:-$(git -C "$SRC" rev-parse --abbrev-ref HEAD)}"
git -C "$SRC" fetch origin "$BRANCH"
git -C "$SRC" checkout -B "$BRANCH" "origin/$BRANCH"
(cd "$SRC/server" && npm install --omit=dev --no-audit --no-fund)
sudo systemctl restart crimson-ronin
sleep 2; curl -fsS http://127.0.0.1:8091/health && echo
git -C "$SRC" log --oneline -1
