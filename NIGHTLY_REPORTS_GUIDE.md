# Little Log nightly reports

MommyBot polls Little Log's read-only API and posts completed nightly reports and
explicitly shared on-demand reports as full UTF-8 Markdown attachments. Ordinary
manual analyses are excluded. Reports do not
pass through MommyBot's model or trigger game actions.

This installation requests channel `1549134762172481557`, including older
nightly reports. These choices are saved in the local `.env`. Publication stays
disabled until a dedicated report-read token is supplied and enabled.

## Setup

1. In Little Log, open **Admin console → AI analysis → MommyBot report
   access**, create a report-read token, and copy the displayed full feed URL.
2. Set these in `.env` locally or `/etc/mommybot/mommybot.env` on Fedora:

   ```dotenv
   MOMMYBOT_REPORTS_ENABLED=true
   MOMMYBOT_REPORTS_URL=https://lidoll.dev/tracker/api/ai-reports/v1/reports
   MOMMYBOT_REPORTS_TOKEN=YOUR_REPORT_READ_TOKEN
   MOMMYBOT_REPORTS_CHANNEL_ID=1549134762172481557
   MOMMYBOT_REPORTS_INITIAL=history
   MOMMYBOT_REPORTS_POLL_MS=60000
   MOMMYBOT_REPORTS_DB=data/reports.db
   ```

   Use your installation's exact feed URL. Wallet and sign-in tokens cannot
   authorize reports. HTTPS and explicit HTTP loopback/private IPv4 destinations
   are supported, including production LAN connections. URL credentials, query
   strings and fragments are rejected.
3. Grant the bot **View Channel**, **Send Messages**, **Attach Files**, and
   **Read Message History** at the destination. A thread also needs access and
   **Send Messages in Threads**.
4. Run `node scripts/check-reports.mjs` (optionally append the environment file
   path). This makes one authenticated GET and prints only count/cursor status.
   It never posts, retrieves document text, or opens the delivery database.
5. Deploy/restart MommyBot. Reports begin posting after Discord is ready,
   independently of the chat channel gate, identity linking and wallets.

The initial policy must explicitly be `history` or `future`. `history` starts at
zero; `future` records the latest cursor on the first successful poll and sends
only later completions. The choice applies only to a new feed/channel pair;
changing it later does not rewind a saved cursor. A different destination has
its own delivery history. The interval accepts 10,000–3,600,000 milliseconds.

## Request an extra report

In Little Log's admin console, save the desired prompt, choose the report date,
then press **Run and share with MommyBot**. Once generation finishes, the bot
picks up that report on its normal poll (one minute by default) and posts the
full attachment in the existing configured channel. **Run now** stays private.
Nightly reports continue automatically. No new token or configuration is needed.

Deploy both the tracker and MommyBot updates before using this action. The bot
accepts `source: manual` only with the tracker-saved `share_with_bot: 1` flag and
binds the downloaded document to that listed sharing choice. On-demand captions
say **Little Log requested report**. Nightly captions remain unchanged so pending
nightly sends can still be reconciled after an upgrade. Existing per-report
delivery receipts prevent repeated polls from reposting the same document.

## Delivery and recovery

To bypass hairpin NAT, point `MOMMYBOT_REPORTS_URL` directly at the tracker on
your trusted LAN. For example, if its backend is `10.1.1.23:4173`:

```dotenv
MOMMYBOT_REPORTS_URL=http://10.1.1.23:4173/tracker/api/ai-reports/v1/reports
```

Use your actual backend address, port and path. HTTP accepts literal addresses
in `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, IPv4 loopback, `localhost`,
and IPv6 loopback (`[::1]`). Use a literal private IPv4 address for a LAN server.
Public HTTP addresses and DNS hostnames other than localhost are rejected.
There is no extra enable flag; the explicitly configured HTTP URL selects the
transport. Redirects remain blocked, so the backend must serve the API directly.
Deploy the updated client before testing the LAN URL with `check-reports.mjs`.

Invalid enabled report settings now disable only the report publisher. Startup
logs name every invalid `MOMMYBOT_REPORTS_*` field and its requirement without
printing configured values; the rest of MommyBot continues starting. Fix those
fields and restart to activate reports. The read-only check remains a failing
command for invalid settings so it can be used before deployment.

Older releases may exit before Discord login with only
`ReportError: invalid_configuration`. To restore service immediately, edit
`/etc/mommybot/mommybot.env` and temporarily set `MOMMYBOT_REPORTS_ENABLED=false`,
then run:

```bash
sudo systemctl reset-failed mommybot.service
sudo systemctl restart mommybot.service
```

Deploy the updated code for specific diagnostics. Check the production settings
without posting anything:

```bash
sudo -u mommybot node /opt/mommybot/current/scripts/check-reports.mjs /etc/mommybot/mommybot.env
```

The check validates report settings even while publication is disabled. Ensure
`MOMMYBOT_REPORTS_CHANNEL_ID=1549134762172481557` and
`MOMMYBOT_REPORTS_INITIAL=history` are present in the service environment; neither
is inferred from local checkout settings. Add the dedicated report-read token
and the full feed URL (public HTTPS or direct LAN HTTP). After the check
passes, set `MOMMYBOT_REPORTS_ENABLED=true` and restart the service. The old generic
error alone does not identify which field is wrong or establish API reachability.

`data/reports.db` stores cursors per feed/channel and receipts keyed by
channel/report ID, including the full document snapshot. Protect it as private
bot data and include its SQLite WAL in consistent backups. Fedora's existing
state backup covers the default location. Run only one publisher process per
journal. Preserve the database across releases and token rotations; deleting
it can republish historical reports.

The bot follows ascending completion cursors, including gaps and late-finishing
jobs. It never skips unread pages using `latest_cursor`. Each poll processes
at most ten pages of twenty reports; subsequent polls continue from the saved
receipt. The document and attempt are saved before sending; the returned
Discord message ID and cursor commit together. Mentions are disabled. A fixed
caption identifies the date, ID, model authorship and output-limit status.

After an uncertain send or crash, the bot searches up to 1,000 recent channel
messages for its exact caption and attachment filename. A matching bot-authored
message completes the receipt without reposting. Without that evidence, the
report remains pending (`delivery_uncertain`); later polls repeat reconciliation.
Discord's short-lived nonce protection cannot guarantee exactly-once delivery
after a long outage. Deleted posts, missing history permission, high channel
traffic, or a crash immediately before sending may require operator recovery.
The publisher never blindly resends an uncertain delivery.

First fix channel/history permissions and allow reconciliation to run. If still
blocked, stop MommyBot, back up the journal, and inspect the destination and
pending row. Only after confirming the report was **not posted**, use a SQLite
editor to reset the attempt for that single pending report:

```sql
UPDATE report_deliveries SET attempted = NULL
WHERE channel = '1549134762172481557'
  AND id = 'REPLACE_WITH_VERIFIED_UNSENT_REPORT_ID'
  AND message_id IS NULL;
```

Restart to retry the saved document. If the report was posted beyond the search
window, retain its journal and reconcile the actual Discord message ID with
operator assistance; do not reset it or delete the database. Changing the feed
URL while this channel has a pending delivery produces `pending_feed_changed`:
restore the original URL and settle that delivery first.

HTTP 401/403 produces `access_denied` and stops publication until restart.
Restore the issuing administrator's access or rotate the token, then restart.
Network/HTTP 5xx failures and malformed responses retain the cursor and retry on
subsequent polls. Logs contain controlled codes, never tokens, report prose or
provider bodies. Disabling the feature preserves its journal. Shutdown drains
active work before closing the database and Discord client.

## Validation

Run `node --test test/reports.test.js` and `npm test`. Tests use synthetic
reports and fake Discord clients to cover history/future setup, API validation,
pagination, attachments, mentions, revocation, failures, receipt recovery,
persistence, overlapping polls and shutdown. A live read-only probe establishes
only API access; posting and destination permissions require configured deployment.
