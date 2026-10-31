#!/usr/bin/env bash
# One-time setup of a projects VM (Ubuntu 24.04): Caddy as the single front door for every project, Tailscale to put
# that door on the internet (Funnel), and Crimson Ronin as the first project. Safe to run again.
#
#   curl -fsSL https://raw.githubusercontent.com/leoxfuchs/CrimsonRoninRepo/contracts-and-campaign/deploy/setup-projects-vm.sh | bash
#   (or, from a clone: bash deploy/setup-projects-vm.sh)
#
# Layout it makes:
#   /srv/projects/<name>/        each project's git checkout
#   /srv/projects-data/<name>/   each project's saved state (outside git, so pulls never touch it)
#   /etc/caddy/projects/<name>.caddy   each project's route, e.g. /crimson-ronin/* -> 127.0.0.1:8091
set -euo pipefail

REPO="${REPO:-https://github.com/leoxfuchs/CrimsonRoninRepo.git}"
BRANCH="${BRANCH:-contracts-and-campaign}"
NAME=crimson-ronin
PORT=8091
SRC=/srv/projects/$NAME
DATA=/srv/projects-data/$NAME
RUN_AS="${SUDO_USER:-$USER}"

say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }

say "Packages: git, Node 20, Caddy"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq caddy
fi

say "Tailscale"
if ! command -v tailscale >/dev/null; then curl -fsSL https://tailscale.com/install.sh | sh; fi
if ! tailscale status >/dev/null 2>&1; then
  echo "Open the link Tailscale prints next and approve this machine:"
  sudo tailscale up
fi

say "Caddy: one front door on 127.0.0.1:8080, one file per project"
sudo mkdir -p /etc/caddy/projects
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
# Tailscale Funnel (or any tunnel) delivers HTTPS here; Caddy routes by path to each project.
{
	auto_https off
	admin localhost:2019
}
:8080 {
	bind 127.0.0.1
	import /etc/caddy/projects/*.caddy
	handle / {
		respond "Projects: /crimson-ronin/" 200
	}
}
EOF
sudo tee /etc/caddy/projects/$NAME.caddy >/dev/null <<EOF
redir /$NAME /$NAME/ 308
handle /$NAME/* {
	reverse_proxy 127.0.0.1:$PORT
}
EOF
sudo systemctl enable --now caddy && sudo systemctl reload caddy

say "Crimson Ronin: checkout ($BRANCH)"
sudo mkdir -p /srv/projects /srv/projects-data
sudo chown "$RUN_AS": /srv/projects /srv/projects-data
if [ -d "$SRC/.git" ]; then git -C "$SRC" fetch origin "$BRANCH" && git -C "$SRC" checkout -B "$BRANCH" "origin/$BRANCH"
else
  if ! git clone --branch "$BRANCH" "$REPO" "$SRC"; then
    echo "The repo is private: add a read-only deploy key and run this again."
    [ -f ~/.ssh/projects_deploy ] || ssh-keygen -t ed25519 -N '' -f ~/.ssh/projects_deploy -C "projects-vm deploy"
    echo "GitHub → CrimsonRoninRepo → Settings → Deploy keys → Add (read-only):"; cat ~/.ssh/projects_deploy.pub
    printf 'Host github.com\n  IdentityFile ~/.ssh/projects_deploy\n' >> ~/.ssh/config
    echo "Then: REPO=git@github.com:leoxfuchs/CrimsonRoninRepo.git bash $0"; exit 1
  fi
fi
mkdir -p "$DATA"
(cd "$SRC/server" && npm install --omit=dev --no-audit --no-fund)

say "Crimson Ronin: service on 127.0.0.1:$PORT"
sudo tee /etc/systemd/system/$NAME.service >/dev/null <<EOF
[Unit]
Description=Crimson Ronin (game page + shared-world server)
After=network-online.target
[Service]
User=$RUN_AS
WorkingDirectory=$SRC/server
Environment=PORT=$PORT BIND=127.0.0.1 STATIC_ROOT=$SRC DATA_DIR=$DATA QUIET=1
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now $NAME && sudo systemctl restart $NAME

say "Funnel: the front door on the internet"
sudo tailscale funnel --bg 8080 || echo "Funnel needs to be allowed for this tailnet: follow the link above, then run: sudo tailscale funnel --bg 8080"

sleep 2
curl -fsS "http://127.0.0.1:$PORT/health" && echo
HOST=$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)
say "Done. Crimson Ronin: https://${HOST:-<this machine>.<tailnet>.ts.net}/$NAME/"
echo "Update later with: bash $SRC/deploy/update.sh"
