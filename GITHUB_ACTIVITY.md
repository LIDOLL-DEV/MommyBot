# Private GitHub activity notifications

MommyBot can poll a private GitHub repository and post repository events to a Discord channel. It handles pushes, pull requests, issues, comments, reviews, releases, branches/tags, forks, stars, and other repository events. Pushes to the default branch are read directly from the commits API so they are delivered promptly; other activity uses GitHub's Events API.

## Setup

1. Create a fine-grained GitHub personal access token for the private repository. Under **Repository permissions**, grant **Metadata: Read-only** and **Contents: Read-only**. Metadata allows MommyBot to see repository events; Contents allows it to retrieve commit messages for cute AI summaries. No write permission is needed.
2. Invite MommyBot to the Discord server with **View Channel**, **Send Messages**, and **Embed Links** permissions for the destination channel.
3. Copy the GitHub settings from `.env.example` into `.env`:
   - `GITHUB_REPOSITORY`: repository in `owner/repository` format.
   - `GITHUB_TOKEN`: fine-grained token that can access that private repository.
   - `GITHUB_ACTIVITY_CHANNEL_ID`: destination Discord channel. If omitted, `CHANNEL_ID` is used.
   - `GITHUB_POLL_INTERVAL_MS`: polling interval; minimum 60000, default 300000.
   - `GITHUB_MAX_ANNOUNCEMENTS`: maximum messages per poll, capped at 20.
   - `GITHUB_ANNOUNCE_EXISTING`: set to `true` to announce recent activity on the first run. The default, `false`, creates a baseline without flooding the channel.
   - `GITHUB_AI_UPDATES`: set to `true` (the default) to have the configured `LLAMA_BASE_URL` generate a cute push summary. MommyBot's `SYSTEM_PROMPT` controls the personality and tone, while commit messages act as the creative brief for what the announcement says. Set it to `false` to use commit details only.
   - `GITHUB_AI_TIMEOUT_MS`: maximum time to wait for the AI summary, default 120000. A failed or timed-out request falls back to the normal update.
4. Restart MommyBot.

The watcher stores its event and commit cursors in `data/github-activity-state.json`. Delete that file to reset the baseline. GitHub tokens are only sent to `api.github.com` and are never included in Discord messages or logs.

GitHub documents that its Events API is not intended for real-time use and can lag by 30 seconds to 6 hours. Default-branch push notices use the commits API to avoid that delay. Pull requests, issues, reviews, releases, and activity on non-default branches can still arrive later.

For push events, repository name, branch, GitHub username, commit author, and commit messages are sent to the AI endpoint configured by `LLAMA_BASE_URL`. Do not enable AI updates if that endpoint is not trusted to receive private repository metadata.
