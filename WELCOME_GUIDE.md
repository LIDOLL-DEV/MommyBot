# New-member welcomes

MommyBot welcomes new human members in channel `1548848205092094034` using the
Discord member-join event. Each welcome tags only that newcomer, links the rules
message, and explains that completing LiD0llID registration and Discord
confirmation is needed for full server access. Bots and joins in other servers
are ignored. Starting the bot does not send welcomes to existing members.

The rules message is `1548865939691405423` in channel `1477184919515041874`
(`rules`), not the welcome channel. Its verified jump link is:
[Read the server rules](https://discord.com/channels/1476335174815056087/1477184919515041874/1548865939691405423).

The generated greeting comes from
`http://192.168.1.250:9090/v1/chat/completions`. It uses `LLAMA_MODEL` and the
shared `SYSTEM_PROMPT`, with the girl/she-her community rule. The welcome
endpoint is independent of chat and router overrides. The model receives only
a generic welcome request, without names, Discord IDs, account data or history.

The bot appends these authoritative steps after the greeting:

1. Read the linked rules message.
2. Open **/menu → Connect / renew**, or run **/lidollid login**.
3. Create an account if needed, sign in in the browser and approve the connection.
4. Return to Discord and paste the browser confirmation code into **Enter sign-in
   code**, or run **/lidollid confirm code:YOUR_CODE**.

The message explains that confirmation lets the bot award the linked-account
role and suggests **/lidollid status** if an already-linked member needs the role
retried. The welcome itself never grants a role or completes registration.

## Settings and deployment

The feature is enabled by default. Deploy the updated source and restart the
bot using the usual Fedora procedure. Existing deployments use the requested
channel, rules message and `.250` defaults without new environment entries.
Settings in `.env.example` can override them:

- `WELCOME_CHANNEL_ID`: destination for new-member messages.
- `WELCOME_RULES_CHANNEL_ID` and `WELCOME_RULES_MESSAGE_ID`: the rules jump link.
- `WELCOME_AI_BASE_URL`: model base URL, default `http://192.168.1.250:9090/v1`.
- `WELCOME_AI_TIMEOUT_MS`: 1,000–15,000 milliseconds; default 8,000.
- `WELCOME_AI_ENABLED=false`: send standard welcomes with all onboarding steps.
- `WELCOME_ENABLED=false`: disable welcomes and omit the added member intent.

Enable **Server Members Intent** on the application's **Bot** page in the
[Discord developer portal](https://docs.discord.com/developers/events/gateway#privileged-intents).
The code requests `GuildMembers` when welcomes are enabled. Discord can reject
Gateway login if the requested privileged intent is not enabled for the app.
The bot needs **View Channel** and **Send Messages** in the welcome channel.
New members also need permission to view the rules and run the account commands;
the linked-account role must be configured to reveal the rest of the server.

Failed, empty, oversized or unusable model responses fall back to a fixed
welcome. Model output cannot add extra pings or replace the rules link. Errors
log fixed diagnostics without provider bodies or member profiles.

Duplicate events share an in-flight request. A bounded in-memory cache suppresses
completed welcomes for the same user and join timestamp for up to a day; a later
rejoin can receive a new welcome. Discord sends use a stable nonce with duplicate
enforcement for immediate network retries. There is no persistent delivery queue
or historical backfill: joins while the bot is offline are not welcomed later,
and a failed Discord send logs an error rather than scheduling extra pings.
Shutdown stops new welcomes and drains pending sends before closing Discord.

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for tests and live acceptance steps.
