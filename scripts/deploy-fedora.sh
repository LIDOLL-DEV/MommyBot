#!/usr/bin/env bash
# Install the local checkout as a systemd service, or deploy a prepared update.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 022

usage() {
    echo 'Usage: sudo bash scripts/deploy-fedora.sh [--update]'
    echo 'Deploys this checkout. Edit /etc/mommybot/mommybot.env after first setup.'
} # Explain the entry point without requiring root or Fedora.

case "${1:-}" in
    -h|--help) usage; exit 0 ;;
    ''|--update) ;;
    *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }
[[ $EUID -eq 0 ]] || { echo 'Run this script with sudo.' >&2; exit 1; }
[[ -r /etc/os-release ]] || { echo 'Fedora is required.' >&2; exit 1; }
. /etc/os-release
[[ ${ID:-} == fedora ]] || { echo 'This script supports Fedora hosts only.' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'A host running systemd is required.' >&2; exit 1; }
command -v dnf >/dev/null || { echo 'A DNF-based Fedora installation is required.' >&2; exit 1; }

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
app=/opt/mommybot
state=/var/lib/mommybot
config=/etc/mommybot/mommybot.env
unit=/etc/systemd/system/mommybot.service
service=mommybot.service
[[ -f "$source_dir/package-lock.json" && -f "$source_dir/src/index.js" ]] || {
    echo 'Run from a complete MommyBot checkout.' >&2; exit 1;
}
exec 9>/run/lock/mommybot-deploy.lock
flock -n 9 || { echo 'Another deployment is in progress.' >&2; exit 1; }

if [[ ${1:-} != --update ]]; then
    dnf install -y nodejs npm git gcc-c++ make python3 tar util-linux shadow-utils policycoreutils
fi
for command in node npm runuser tar restorecon; do
    command -v "$command" >/dev/null || { echo "Missing $command; run initial deployment first." >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required."); process.exit(1); }'

if ! id mommybot >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$state" --shell /usr/sbin/nologin mommybot
fi
[[ $(id -u mommybot) -ne 0 ]] || { echo 'mommybot must be an unprivileged account.' >&2; exit 1; }
install -d -m 0755 "$app" "$app/releases"
install -d -m 0700 "$app/backups"
install -d -o mommybot -g mommybot -m 0700 "$state" "$state/data" "$state/.sakura_rag"
install -d -o root -g mommybot -m 0750 /etc/mommybot

if [[ ! -f "$config" ]]; then
    install -o root -g mommybot -m 0640 "$source_dir/.env.example" "$config"
    echo "Created $config. Set DISCORD_TOKEN and the model endpoints, then rerun this command."
    echo 'Existing local .env and data are not copied automatically; see DEPLOYMENT_FEDORA.md for migration.'
    exit 0
fi
# Parse dotenv as data later; never execute a secrets file as a shell script.
chown root:mommybot "$config"
chmod 0640 "$config"

previous=$(readlink -f "$app/current" 2>/dev/null || true)
if [[ -e "$app/current" && ! -L "$app/current" ]]; then
    echo "$app/current must be a deployment-managed symlink." >&2; exit 1
fi
if [[ -n "$previous" && "$previous" != "$app/current" ]]; then
    [[ "$previous" == "$app/releases/"* && -d "$previous" ]] || {
        echo 'The current release points outside the release directory or is missing.' >&2; exit 1;
    }
else
    previous=''
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
release="$app/releases/$stamp"
backup="$app/backups/$stamp"
changed=0
was_active=0
was_enabled=0
systemctl is-active --quiet "$service" && was_active=1
systemctl is-enabled --quiet "$service" 2>/dev/null && was_enabled=1

switch_release() {
    ln -sfn -- "$1" "$app/.current-next"
    mv -Tf -- "$app/.current-next" "$app/current"
} # Replace the current release symlink atomically on the same filesystem.

recover() {
    local status=$?
    trap - EXIT INT TERM
    if [[ $status -ne 0 && $changed -eq 1 ]]; then
        set +e
        echo "Deployment failed; restoring the previous service. Backup: $backup" >&2
        systemctl stop "$service"
        if [[ -n "$previous" ]]; then
            switch_release "$previous"
        else
            rm -f -- "$app/current"
        fi
        if [[ -f "$backup/mommybot.service" ]]; then
            cp -p -- "$backup/mommybot.service" "$unit"
        else
            systemctl disable "$service"
            rm -f -- "$unit"
        fi
        systemctl daemon-reload
        if [[ $was_enabled -eq 0 ]]; then systemctl disable "$service"; fi
        if [[ $was_active -eq 1 ]]; then
            systemctl reset-failed "$service"
            systemctl start "$service" || echo 'Previous service could not start; inspect journalctl.' >&2
        fi
        echo 'Data is preserved; automatic recovery restores code and the unit only.' >&2
    fi
    exit "$status"
} # Restore the old code and service state if activation or readiness fails.
trap recover EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

install -d -o mommybot -g mommybot -m 0755 "$release"
# Copy only application inputs, so local credentials, databases and node_modules stay out.
tar -C "$source_dir" -cf - package.json package-lock.json src assets diaper-gacha scripts/check-lidollid.mjs scripts/check-wallet.mjs scripts/check-runtime.mjs | tar -C "$release" -xf -
revision=$(git -c safe.directory="$source_dir" -C "$source_dir" rev-parse --short HEAD 2>/dev/null || echo unknown)
modified=$(git -c safe.directory="$source_dir" -C "$source_dir" status --porcelain 2>/dev/null || true)
node --input-type=module - "$release/release.json" "$revision" "$stamp" "$modified" <<'NODE'
import fs from 'node:fs';
fs.writeFileSync(process.argv[2], JSON.stringify({ revision: process.argv[3], deployment: process.argv[4], modified: Boolean(process.argv[5]) }) + '\n');
NODE
# Record which checkout supplied the running code, including manually deployed local changes.
if [[ -d "$source_dir/test" ]]; then
    tar -C "$source_dir" -cf - test | tar -C "$release" -xf -
fi
chown -R mommybot:mommybot "$release"
cd -- "$release"
runuser -u mommybot -- env HOME="$state" npm ci --omit=dev --no-audit --no-fund
if [[ -d test ]]; then
    runuser -u mommybot -- env HOME="$state" node --test
fi
# Exercise native SQLite loading without opening or changing the live memory database.
runuser -u mommybot -- node --input-type=module -e '
import { ConversationSqliteSaver as SqliteSaver } from "./src/db/sqliteSaver.js";
const saver = SqliteSaver.fromConnString(":memory:");
saver.setup();
saver.db.close();
'
runuser -u mommybot -- node --input-type=module - "$config" <<'NODE'
import fs from 'node:fs';
import dotenv from 'dotenv';
import { authConfig } from './src/auth/config.js';
import { walletConfig } from './src/wallet/client.js';
import { gachaConfig, loadDiaperCatalog } from './src/gacha/catalog.js';
import { hangmanConfig } from './src/hangman/words.js';
const settings = dotenv.parse(fs.readFileSync(process.argv[2])); // Read configuration without executing it.
authConfig({ ...settings, NODE_ENV: 'production' }); // Reject invalid SSO settings before stopping the active release.
gachaConfig(settings);
hangmanConfig(settings);
loadDiaperCatalog(); // Check every collectible asset before swapping releases.
if (walletConfig({ ...settings, NODE_ENV: 'production' }) && settings.LIDOLLID_ENABLED !== 'true') {
    throw new Error('Online wallets require LIDOLLID_ENABLED=true for their Discord commands.');
}
if (settings.LIDOLLCOIN_ENABLED === 'true' && settings.TOUHOU_ENABLED === 'false') {
    throw new Error('Online wallets require Touhou Trader for pending payment recovery.');
}
if (!settings.DISCORD_TOKEN?.trim() || settings.DISCORD_TOKEN === 'your_discord_bot_token') {
    console.error('Set DISCORD_TOKEN in /etc/mommybot/mommybot.env before deploying.');
    process.exit(1);
}
NODE
if ! runuser -u mommybot -- node scripts/check-runtime.mjs "$config"; then
    echo 'WARNING: Model connectivity checks failed. Discord/wallet features can still run; fix the model endpoints in /etc/mommybot/mommybot.env.' >&2
fi
chown -R root:root "$release"
chmod -R u=rwX,go=rX "$release" # Keep code readable even when the checkout used a private umask.
ln -s -- "$state/data" "$release/data"
ln -s -- "$state/.sakura_rag" "$release/.sakura_rag"
ln -s -- "$config" "$release/.env"
restorecon -RF "$app" "$state" /etc/mommybot

install -d -m 0700 "$backup"
if [[ -f "$unit" ]]; then cp -p -- "$unit" "$backup/mommybot.service"; fi
cp -p -- "$config" "$backup/mommybot.env"
changed=1
systemctl stop "$service" 2>/dev/null || {
    # An absent unit is expected on first install; a failed stop must abort updates.
    [[ $(systemctl show "$service" -p LoadState --value) == not-found ]]
}
tar -C "$state" -czf "$backup/state.tar.gz" data .sakura_rag
install -m 0644 "$source_dir/scripts/mommybot.service" "$unit"
restorecon "$unit"
switch_release "$release"
systemctl daemon-reload
systemctl reset-failed "$service" 2>/dev/null || true
systemctl start "$service"

ready=0
for ((attempt = 0; attempt < 30; attempt++)); do
    invocation=$(systemctl show "$service" -p InvocationID --value)
    if [[ -n "$invocation" ]] && systemctl is-active --quiet "$service" &&
        journalctl --quiet --no-pager "_SYSTEMD_INVOCATION_ID=$invocation" -o cat |
        grep -F 'Sakura is online and ready to cuddle!' >/dev/null; then
        ready=1
        break
    fi
    sleep 2
done
[[ $ready -eq 1 ]] || { echo 'Discord readiness was not reached within 60 seconds. Check journalctl -u mommybot.' >&2; exit 1; }
systemctl enable "$service"
changed=0
echo "Deployment ready: $release"
echo "Source revision: $revision"
echo "Backup: $backup"
echo 'Logs: sudo journalctl -u mommybot -f'
