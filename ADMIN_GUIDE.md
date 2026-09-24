# Sakura admin panel, starboard and reaction roles

## Sign in

After deploying and restarting, open **https://bot.lidoll.dev/admin/**, or append
`/admin/` to `LIDOLLID_PUBLIC_ORIGIN`. The panel uses the existing HTTPS listener
and registered `/auth/callback`; no extra port, client or wallet consent is needed.
Your reverse proxy must forward `/admin/` alongside the existing auth/game routes.

First run `/lidollid login` and finish `/lidollid confirm` in Discord. Sign into
the panel with that same LiD0llID. It lists only servers where the linked Discord
account has **Administrator** permission and MommyBot is present. Manage Server
alone is insufficient. Every server read/write rechecks membership and permission;
unlinking or losing Administrator permission removes access. Sessions use separate
HttpOnly cookies, expire after eight hours, and can be ended with Sign out.
The panel requires `LIDOLLID_ENABLED=true`; saved reaction features continue if
SSO is later disabled.

## Server controls

Pronoun roles are matched by name: **She/Her** uses she/her, **He/Him** uses
he/him, and **It's Complicated** uses they/them with neutral address. Case and
spacing are ignored; straight and curly apostrophes work. No role IDs or extra
environment variables are needed. Keep these names when setting up reaction roles.
It's Complicated takes precedence; holding both gendered roles, having neither,
or an unavailable membership lookup produces neutral wording. DMs use neutral
wording because they have no server role context. Roles are refreshed for each
reply, including retried swear-jar notices. Assign only the intended pronoun role
to avoid conflicting selections; reaction roles allow multiple choices.

Choose a server and press **Save server settings** after making changes.
Conversation replies, new swear-jar fines/apologies, and member welcomes can each
be paused for this server. **Channels the swear jar ignores** exempts individual
channels instead of the whole server; threads follow their parent channel, and
apologies and reminders are skipped there too. **Swear jar words** replaces the
built-in word list for this server, one word or phrase per line; leave it empty
to use the deployment's own list. Global environment switches and
`CHANNEL_ID` still apply. Saved payments, pending notices and weekly draws continue recovering;
account commands and games remain available. The dashboard shows connection
status, gateway ping and feature availability without exposing secrets or wallets.

## Diaper checks

Initially off. Choose a check channel that is **not** visible to `@everyone` and a
participating role, then enable and save. Only LiDollID-verified members holding
that role are ever asked. Every two to four hours MommyBot tags one of them, in
turn, to ask whether they are dry or wet, and believes whatever they answer.
Saying they are not wearing one at all gets a gentle reminder to go and put one
on. Nothing is asked between
22:00 and 06:00 server time, except a check you start yourself with
`/diapercheck ask member:@someone`, which is private, immediate and still
respects the opt-in role. See [DIAPER_CHECKS_GUIDE.md](DIAPER_CHECKS_GUIDE.md).

## Character showcase

Initially off. Choose a channel where MommyBot can Send Messages, Embed Links and
Attach Files, then enable and save. Members run `/lidollmmo` to post their
LiDollQuest character there as three messages: paperdoll, stats and equipment.
The command replies privately and always posts in this channel, wherever it was
run. Members need a linked LiD0llID wallet, and each may post once a minute.
See [MMO_ONLINE_GUIDE.md](MMO_ONLINE_GUIDE.md).

## Starboard

Initially off. Choose a highlight channel, public source channels, emoji
(default **⭐**) and threshold (default **3**), then enable and save. Distinct human
normal reactions count; bots, self-stars and super reactions do not. Bot-authored
messages are excluded. Custom emoji must belong to this server.

If your channels are gated behind LiD0llID verification, choose that role as the
**audience** instead of leaving the starboard open to everyone. Source channels
must then be visible to the audience role rather than to `@everyone`, and the
starboard channel must be hidden from `@everyone`, so a highlight never reaches
more people than its source. Highlights are rechecked on every synchronization
and withdrawn if the source narrows or the starboard widens.

Each qualifying source gets one highlight with its text, author, count, jump
link, and an eligible non-spoiler image attachment. Counts and edits update the
post. Falling below the threshold, deleting the source, removing its source
channel or disabling starboard removes the highlight during synchronization.
Sources must be text/announcement channels visible to the audience, which is
`@everyone` unless a role is chosen; threads are unsupported. Age-restricted sources require an age-restricted
destination. The highlight channel cannot also be a source.

There is no channel-history scan: new reaction events and already tracked messages
are synchronized. Untracked messages that became eligible entirely while offline
need another reaction event. Failed first-publication attempts are saved for retry.
Discord nonce protection reduces short-interruption duplicates; a crash after a
send but before saving its ID can still duplicate a highlight outside Discord's
nonce deduplication window.

## Reaction roles

Create a message in Discord, select its channel, and paste its link or ID into
the panel. Choose an emoji and role, then press **Add another emoji / role** for
each additional choice on that message. **Save choices & add emojis** saves up
to twenty choices together and adds their reactions. Existing normal reactions
are synchronized too. Members can react to several choices to receive several
roles. Each choice needs a different emoji and role; each role can have only one
mapping per server. Invalid or conflicting choices prevent the entire batch
from being saved. Existing mappings remain unchanged. The message stays selected
after saving so you can add more choices without pasting its link again.

Emoji fields in reaction roles and starboard accept actual Unicode symbols (for
example `♀️`), server custom emoji names like `:female_emoji:`, full
`<:name:id>` / `<a:name:id>` codes, or custom emoji IDs. Names must match a custom
emoji in the selected server. For standard emoji, paste the symbol itself.
If multiple custom emojis share a name, use the full code or ID. Saved mappings
use the resolved ID, so renaming a custom emoji does not break its mapping.

Reacting grants the role; unreacting removes it **only if this mapping granted
it**. Roles already held are preserved. Reaction clears and source deletion
reconcile bot-owned grants. Removing a mapping stops managing it and retains
existing roles and reactions. Reacting members need no LiD0llID account.

Everyone, managed/integration, admin and moderation roles are excluded. The bot's
highest role must be above the target role; non-owner admins must also outrank it.
Runtime checks refuse roles that become privileged/unmanageable. See Discord's
[role hierarchy rules](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx).

## Permissions and recovery

- Sources: View Channel and Read Message History.
- Starboard destination: View Channel, Read Message History, Send Messages,
  Embed Links. Manage Messages is unnecessary for the bot's own highlights.
- Reaction roles: Manage Roles and a higher bot role; Add Reactions to seed emoji.

The client requests Guild Message Reactions and partial message/reaction/user
events, following the [discord.js reaction guide](https://discordjs.guide/legacy/popular-topics/reactions).
Keep the existing Message Content intent enabled and restart after deploying.
No additional privileged reaction intent toggle is required.

Sync runs on events, startup, **Sync reactions**, and every five minutes. It
fetches current reactions/roles to reconcile offline changes. Limits per server:
one hundred mappings and fifty starboard sources; ten thousand normal reactors
per message emoji. Errors appear in the admin journal; correct permissions and
press Sync reactions. Configuration, grants, highlights, pending publications and
the latest two hundred audit entries per server live in **data/admin.db**. The
panel shows the latest thirty. Back this up with the other databases; Fedora's
shared `data/` directory already survives deployment. Deleting it loses ownership
records for existing roles and highlights.

## Tests

Run `npm test`, or
`node --test test/admin-community.test.js test/admin-web.test.js test/lidollid.test.js`.
With `PUPPETEER_MODULE` and `CHROME_PATH` pointing to local tools, run
`node scripts/check-admin-browser.mjs` for desktop/mobile screenshots under
`data/admin-review/`. All checks use synthetic Discord and disposable databases;
they do not send live messages or move currency.
