# Testing MommyBot

## Local checks

Use a separate checkout if a running Windows instance has its native SQLite
module loaded; Windows can prevent npm from replacing that file.

```bash
npm ci
npm test
bash -n scripts/deploy-fedora.sh
bash -n scripts/update-fedora.sh
bash scripts/deploy-fedora.sh --help
bash scripts/update-fedora.sh --help
```

The existing Node tests exercise GitHub activity fetching with mocked HTTP
responses. They do not log into Discord or require a model server. Optional
static checks on Fedora: install `ShellCheck` and run
`shellcheck scripts/*-fedora.sh`, then run
`systemd-analyze verify scripts/mommybot.service` after deployment paths exist.

## Fedora acceptance checks

Use a test bot/channel and a Fedora VM with systemd for deployment validation.

1. Follow [DEPLOYMENT_FEDORA.md](DEPLOYMENT_FEDORA.md). Confirm the first invocation
   creates settings without starting an unconfigured bot.
2. Configure the bot and deploy again. Confirm `systemctl is-active mommybot`
   and `systemctl is-enabled mommybot` succeed; check the journal for Discord login.
3. Mention the bot in the allowed channel and verify it reaches the configured
   model. Restart the service and check that conversation memory persists.
4. Run the updater from a clean checkout with an upstream. Confirm the release
   symlink changes, settings remain unchanged, a state archive appears, and the
   existing memory/cursors remain available.
5. Verify dirty checkouts, detached HEADs and missing upstreams are rejected
   before deployment. Concurrent deployments should be refused by the lock.
6. On a disposable test branch, break the npm lockfile and confirm installation
   fails while the existing service stays running. Separately test a startup
   failure after installation; confirm the prior release and service return.
7. Test with SELinux enforcing, reboot and confirm the bot starts automatically.

Discord login is the deployment health check; model availability and complete
conversation behavior require the manual reply check. Rollback restores code
and the systemd unit, while preserving current runtime data.
