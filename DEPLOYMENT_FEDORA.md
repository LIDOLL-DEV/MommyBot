# Fedora deployment and updates

These scripts deploy MommyBot/Sakura on a conventional Fedora host with DNF,
systemd and sudo. They install Node.js and native SQLite build tools, then run
the bot as the unprivileged `mommybot` account. Node.js 22 or newer is required.
Fedora Atomic desktops, containers without systemd, and installation of llama.cpp
or model files are outside this setup.

## First deployment

Clone this repository on the Fedora host as your normal user, check out the branch
you want to run, then run these commands from its root:

```bash
sudo bash scripts/deploy-fedora.sh
sudoedit /etc/mommybot/mommybot.env
sudo bash scripts/deploy-fedora.sh
```

The first run installs prerequisites and creates a configuration template, then
exits so you can edit it. The second run installs the app, waits up to 60 seconds
for Discord login, and enables startup on boot.

Set `DISCORD_TOKEN` to your bot token. Set `CHANNEL_ID` to the channel the bot
should answer in, or leave it empty to allow all channels. Enable the bot's
Message Content intent in Discord's developer portal. New-member welcomes also
require **Server Members Intent** on the bot's application page; enable it before
deploying this feature or set `WELCOME_ENABLED=false` to omit that intent and
pause welcomes. See [WELCOME_GUIDE.md](WELCOME_GUIDE.md) for the default welcome
channel, verified rules link and `.250` generation endpoint. Set `LLAMA_BASE_URL` and
`ROUTER_LAMA_URL` to OpenAI-compatible servers reachable from Fedora, including
the `/v1` suffix. The spelling `ROUTER_LAMA_URL` is intentional: it matches the
existing code. Adjust `LLAMA_MODEL` if your server requires a model name.

Leave GitHub repository/token settings empty to disable the activity watcher;
see [GITHUB_ACTIVITY.md](GITHUB_ACTIVITY.md) to enable it. The template's sample
values must be replaced or cleared. Do not source the configuration in a shell:
the app reads it using dotenv, including quoted values.

The bot needs outbound access to Discord, its model endpoints and optionally
GitHub. The installer does not open inbound firewall ports or disable SELinux.
Stop any other instance using this bot token before starting the Fedora instance
to avoid duplicate replies and notifications.

## Updates

Commit and push the deployment files and dependency lockfile to the branch used
on the Fedora host. In that host's checkout, run as your normal Git user:

```bash
bash scripts/update-fedora.sh
```

The updater requires a clean checkout and a branch with a configured upstream.
It uses your own SSH/HTTPS Git credentials to run `git pull --ff-only`, then
requests sudo for deployment. It does not reset changes, switch branches or
embed Git credentials. An update deploys the current checkout even when there
are no new commits, which also allows retrying a failed deployment.

To deploy a manually prepared checkout without pulling or reinstalling system
packages, run `sudo bash scripts/deploy-fedora.sh --update`. Run the command
without `--update` if prerequisites need installing again. Initial deployment
copies the local application files, including local edits; the updater instead
requires those edits to be committed first.

Each deployment installs production dependencies with `npm ci`, runs available
Node tests, and checks the native SQLite module with an in-memory database before
stopping the current service. It then backs up state, switches the release and
checks the new systemd invocation's Discord-ready log. Failed activation restores
the previous code and unit and restarts the previous service if it was running.
Readiness confirms Discord login; test an actual reply to verify model access.

Each new release records its source revision in `release.json` and logs it at
startup. The deployer and startup also report `[Swear jar] ON`, `OFF`, `PAUSED`
or `NO MATCHES`, plus independent `[Brain]` checks of both model servers. A model
probe failure warns without disabling Discord or wallet features. The probes
GET `/v1/models`; they do not generate text or prove inference works.

Run the same read-only diagnostics against the active release and production
settings, without printing the secrets file:

```bash
sudo -u mommybot node /opt/mommybot/current/scripts/check-runtime.mjs /etc/mommybot/mommybot.env
```

If the active release predates that diagnostic script, run it from a newly
updated checkout or redeploy first. A deployment finishing before the feature
commit cannot include that feature unless its changes were already in the local
checkout. Pull and deploy again after the commit has reached the server's branch.

### September 14 model-address and swear-jar recovery

The reported `20260914T165459Z-54038` release started before the swear-jar commit
`da2b659` at 16:56:33 UTC. Its log routes `fuck` into the LLM instead of the swear
jar. Deploy a checkout containing `da2b659` or newer. For an existing installation:

```bash
cd ~/MommyBot
bash scripts/update-fedora.sh
sudoedit /etc/mommybot/mommybot.env
```

The same logs target `192.168.1.188:9090` and `:9091`, which timed out during
investigation. Both model servers at `192.168.1.250` returned model lists and
generated synthetic test answers from the development machine. Set the Fedora
configuration to these verified endpoints if these are still the intended
servers, then verify connectivity from Fedora itself:

```dotenv
LLAMA_BASE_URL=http://192.168.1.250:9090/v1
ROUTER_LAMA_URL=http://192.168.1.250:9091/v1
```

```bash
curl --fail --max-time 5 http://192.168.1.250:9090/v1/models
curl --fail --max-time 5 http://192.168.1.250:9091/v1/models
sudo systemctl restart mommybot
sudo journalctl -u mommybot -n 40 --no-pager
```

If Fedora cannot reach those addresses, check its route to the model host and
the host's listeners/firewall. A reachable Discord connection does not test that
LAN route. The swear jar requires `LIDOLLID_ENABLED=true` and
`LIDOLLCOIN_ENABLED=true`; remove `SWEAR_JAR_ENABLED=false` or an empty
`SWEAR_JAR_WORDS` override to restore default detection. Do not copy the checkout
`.env` over the production file: edit only the intended settings in
`/etc/mommybot/mommybot.env`. Deployments deliberately preserve that file.

Deployments also copy the Touhou trader's `assets/` directory. Its wallets and
collections live in `data/touhou-trader.db` and are included in state backups.
See [TOUHOU_TRADER_GUIDE.md](TOUHOU_TRADER_GUIDE.md) for commands, reward permissions
and the 1-star-or-25-LiDollcoin adoption price.

## Files and migration

| Path | Purpose |
| --- | --- |
| `/etc/mommybot/mommybot.env` | Secrets/settings, readable by root and the bot group |
| `/var/lib/mommybot/data` | SQLite memory and GitHub activity cursors |
| `/var/lib/mommybot/.sakura_rag` | Preserved optional local state directory |
| `/opt/mommybot/releases/<timestamp>` | Application code and Linux dependencies |
| `/opt/mommybot/current` | Symlink to the active release |
| `/opt/mommybot/backups/<timestamp>` | Stopped-state archive, configuration and previous unit |

An existing checkout's `.env`, `data`, `.sakura_rag` and `node_modules` are never
copied into releases. To migrate existing memory, stop the old bot first, create
the Fedora configuration using the first deployment command, then copy your old
configuration to `/etc/mommybot/mommybot.env` and the complete old `data/` contents
to `/var/lib/mommybot/data/`. Include SQLite WAL/SHM files if present. Copy
`.sakura_rag/` contents to the matching state directory if needed. Before the
second deployment, fix ownership and SELinux labels:

```bash
sudo chown -R mommybot:mommybot /var/lib/mommybot
sudo chmod -R go-rwx /var/lib/mommybot
sudo chown root:mommybot /etc/mommybot/mommybot.env
sudo chmod 640 /etc/mommybot/mommybot.env
sudo restorecon -RF /var/lib/mommybot /etc/mommybot
```

Leave `GITHUB_STATE_FILE` unset to use the persistent `data/` directory. A custom
absolute path must be under `/var/lib/mommybot` to be writable by the service.
The automatic archive includes `data` and `.sakura_rag` only, so keep a custom
cursor inside `data` if it should be backed up.

## Operations and recovery

Optional LiD0llID SSO requires a registered `lidollbot` client, an HTTPS callback
hostname/proxy, and the `LIDOLLID_*` settings added to the existing environment
file. Follow [LIDOLLID_GUIDE.md](LIDOLLID_GUIDE.md) before enabling it. The bot
listens on loopback port 4190 by default; the deployer does not provision DNS,
TLS or an inbound firewall rule. Its new account database is included in the
existing `data/` backups. SSO configuration is checked before release activation.

If a second message fails with `checkpoint.pending_sends is not iterable`, deploy
the checkpoint compatibility fix using the updater once it is available in your
Git upstream. This fixes the dependency mismatch and reads existing legacy
checkpoints without requiring deletion of `memory.db`. The deployment tests now
exercise a second turn, a database reopen and legacy checkpoint loading.

If the model server is unavailable, start it separately and verify
`LLAMA_BASE_URL` in `/etc/mommybot/mommybot.env`. The previous
"Hmm, let Mommy think..." response was a local fallback when a successful HTTP
response contained no answer text. Empty completions now produce an explicit
error and journal diagnostics (finish reason and token/reasoning counts).
An HTTP response alone does not prove the model produced an answer.

```bash
sudo systemctl status mommybot --no-pager
sudo journalctl -u mommybot -f
sudo systemctl restart mommybot
sudo systemctl stop mommybot
```

After editing settings, restart the service. Keep the checkout separate from
`/opt/mommybot`; releases are deployment outputs, not places to edit code.

For a manual code rollback, replace `RELEASE_TIMESTAMP` below with an existing
directory name from `/opt/mommybot/releases`:

```bash
sudo systemctl stop mommybot
sudo ln -sfn /opt/mommybot/releases/RELEASE_TIMESTAMP /opt/mommybot/.current-next
sudo mv -Tf /opt/mommybot/.current-next /opt/mommybot/current
sudo systemctl reset-failed mommybot
sudo systemctl start mommybot
```

Code rollback does not rewind memory or GitHub cursors. State backups are taken
with the bot stopped; restore them only with the service stopped and after saving
the current state separately. Future database migrations may need a deliberate
state restore as well as a code rollback. A failed Git/dependency/test step leaves
the active service untouched; an activation failure prints its backup location.
Inspect the journal if recovery cannot restart the previous service.

Releases, failed build directories and backups are retained. Review disk usage
periodically and remove only versions you no longer need, keeping the active
release and at least one known-good release/backup. Backups contain private bot
memory and credentials and are stored in a root-only directory.

Package installation follows the [Fedora Node.js documentation](https://developer.fedoraproject.org/tech/languages/nodejs/nodejs.html).


## Play through Little Log

[Games in Little Log](GAMES_GUIDE.md) documents the new PWA Games page, direct LiD0llID sign-in for all three games, Touhou browser controls, session behavior and deployment order. Existing Discord commands and saved collections remain available.


## Diamonds

Deploy the identity service with diamonds:read/diamonds:write support, then Little Log market schema 9, then MommyBot. If the lidollbot identity client has an explicit scope allowlist, extend it with both diamond scopes while preserving existing scopes and registrations. The tracker wallet app accepts an optional diamondDailyLimit (default max(1, floor(dailyLimit / 50))). Back up tracker science/market databases and bot state before upgrading. After deployment, players renew consent with /lidollid login; bot startup registers the new diamond gift choice.
