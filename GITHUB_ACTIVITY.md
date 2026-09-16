# Private GitHub activity notifications

MommyBot can poll multiple GitHub repositories and post their events to one Discord channel. Each repository has independent event and commit cursors. It handles pushes, pull requests, issues, comments, reviews, releases, branches/tags, forks, stars, and other repository events. Pushes to the default branch are read directly from the commits API so they are delivered promptly; other activity uses GitHub's Events API.

## Track more than one repository

After deploying the version with multi-repository support, set this in `.env`, or
in `/etc/mommybot/mommybot.env` for the Fedora service:

```dotenv
GITHUB_REPOSITORIES=your-owner/first-repo,your-owner/second-repo
GITHUB_TOKEN=your_existing_token
GITHUB_ACTIVITY_CHANNEL_ID=your_discord_channel_id
GITHUB_ANNOUNCE_EXISTING=false
```

Use actual `owner/repository` names, without GitHub URLs. Keep your existing token
and channel values; the token must have access to every listed repository.
`GITHUB_REPOSITORIES` takes precedence over `GITHUB_REPOSITORY`; the singular
setting still works when the list is absent. Duplicate names are ignored without
regard to capitalization. All listed repos use the same token and destination.

Restart MommyBot after editing configuration. On Fedora:

```bash
sudo systemctl restart mommybot
```

The existing single-repository cursor migrates automatically. Newly added repos
start from current activity unless `GITHUB_ANNOUNCE_EXISTING=true`. Reordering the
list does not replay announcements. Temporarily removed repos keep their saved
cursors and resume when restored. An API or delivery failure for one repo leaves
its cursor unchanged and allows the other repos to continue.

## Setup

1. Create a fine-grained GitHub personal access token for the private repository. Under **Repository permissions**, grant **Metadata: Read-only** and **Contents: Read-only**. Metadata allows MommyBot to see repository events; Contents allows it to retrieve commit messages for cute AI summaries. No write permission is needed.
2. Invite MommyBot to the Discord server with **View Channel**, **Send Messages**, and **Embed Links** permissions for the destination channel.
3. Copy the GitHub settings from `.env.example` into `.env`:
   - `GITHUB_REPOSITORIES`: comma-separated repositories in `owner/repository` format.
   - `GITHUB_REPOSITORY`: backward-compatible single-repository alternative.
   - `GITHUB_TOKEN`: token that can access all configured repositories.
   - `GITHUB_ACTIVITY_CHANNEL_ID`: destination Discord channel. If omitted, `CHANNEL_ID` is used.
   - `GITHUB_POLL_INTERVAL_MS`: polling interval; minimum 60000, default 300000.
   - `GITHUB_MAX_ANNOUNCEMENTS`: maximum activity messages per repository per poll, capped at 20 (plus an omitted-events notice when needed).
   - `GITHUB_ANNOUNCE_EXISTING`: set to `true` to announce recent activity on the first run. The default, `false`, creates a baseline without flooding the channel.
   - `GITHUB_AI_UPDATES`: set to `true` (the default) to have the configured `LLAMA_BASE_URL` generate a cute push summary. MommyBot's `SYSTEM_PROMPT` controls the personality and tone, while commit messages act as the creative brief for what the announcement says. Set it to `false` to use commit details only.
   - `GITHUB_AI_TIMEOUT_MS`: maximum time to wait for the AI summary, default 120000. A failed or timed-out request falls back to the normal update.
4. Restart MommyBot.

The watcher stores its event and commit cursors in the version-2 `repositories`
map in `data/github-activity-state.json`, keyed by lowercase `owner/repository`.
Keep that file when adding repos; deleting it resets every baseline. Older bot
versions do not understand the new map, so rolling back this feature requires a
matching state backup if you need to retain the old single-repo cursor.
GitHub tokens are only sent to `api.github.com` and are never included in Discord messages or logs.

GitHub documents that its Events API is not intended for real-time use and can lag by 30 seconds to 6 hours. Default-branch push notices use the commits API to avoid that delay. Pull requests, issues, reviews, releases, and activity on non-default branches can still arrive later.

For push events, repository name, branch, GitHub username, commit author, and commit messages are sent to the AI endpoint configured by `LLAMA_BASE_URL`. Do not enable AI updates if that endpoint is not trusted to receive private repository metadata.
