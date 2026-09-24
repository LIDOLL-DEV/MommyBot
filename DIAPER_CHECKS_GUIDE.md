# MommyBot's diaper checks

MommyBot asks opted-in members in Discord whether their diaper is still dry.
Every two to four hours each server tags one LiDollID-verified member of its
participating role, and an administrator can ask anyone at any time. MommyBot
believes whatever the member answers: nothing is checked against any record.

Every question is one mention plus a short AI-written line. MommyBot appends the
exact answer instructions. No record, count, time or message text is ever sent to
the AI, and nothing about a member's records is ever quoted in the channel.

## Opting in

Diaper checks are off until a server administrator enables them in the admin
panel and chooses both a **check channel** and a **participating role**.

The channel must **not** be visible to `@everyone`; the panel refuses a public
one, because these questions are personal. The role is the opt-in: only members
holding it who have also linked a verified account with `/lidollid login` are
ever asked. Removing
the role stops checks immediately, including for a question already waiting to be
sent. Leaving the server has the same effect.

## Random checks

Each server has its own window of **two to four hours**, drawn at random and
redrawn after every check of any kind. When it passes, MommyBot tags **one**
member and asks *"Is your diaper still dry?"*. A newly enabled server waits a
full window before its first check, so enabling the feature does not immediately
ping anyone.

The candidates are every LiDollID-verified account whose Discord member is in
this server and holds the participating role. If nobody qualifies, the server
simply waits another window.

## One at a time, and everyone in turn

A server only ever has **one open question**. While a member has been asked and
has not answered, no other member is asked, whether at random or on demand. A
member is never asked in two servers at once either.

Who gets asked is a **rotation, not a raffle**. MommyBot logs every member it has
called, and always draws from those called fewest times, at random among ties. So
everyone eligible is asked once before anyone is asked a second time. The call log
is durable, so a restart does not reset the rotation.

## Answers

MommyBot reads the member's next message in the check channel. The question is
*"is your diaper still dry?"*, so **yes**, **yeah**, **yep**, **mhm**, **dry** and
**I'm clean** mean dry, while **no**, **nope**, **nah**, **wet** and **messy** mean
wet. These are recognized directly, with or without addressing Mommy, as are the
"not wearing one" wordings below. Other wording goes to the router classifier,
which answers dry, wet, undiapered or unclear.

| Answer | Result |
| --- | --- |
| Dry | Warmly thanked for checking in. |
| Wet | Believed, reassured that accidents are perfectly okay, and gently encouraged to get changed. |
| Not wearing one | A gentle **not wearing your protection** notice asking them to go and put a fresh one on. |
| Unclear | One request for a plain yes or no. Further unclear messages go to ordinary conversation. |

**Not wearing one** covers the natural variations directly, without a model
request: *I'm not wearing a diaper*, *no diaper right now*, *not wearing one*,
*without a nappy*, *I don't have one on*, *I'm diaper free*, *not diapered*,
*I took it off*, and being in ordinary or big-kid underwear. Other phrasings go
to the classifier, which has this as a fourth label.

It outranks yes and no in the same message, so *"yes but I'm not wearing a
diaper"* gets the protection reminder. Wearing one is never misread as the
opposite, so *"I'm diapered"* and *"no one is home"* are unaffected.

Mommy trusts every answer. Nothing is recorded in the admin journal, nothing
costs coins, and nobody is ever told they are fibbing. An unreachable classifier
asks again rather than guessing. Unanswered questions expire after an hour, are
not chastised for silence, and stop blocking the next check.

## Continuing the conversation

A closed check does not end the exchange. For **15 minutes** afterwards, up to
**four** more messages from that member in the check channel get a reply, so
saying *"I changed five minutes ago"* after answering is acknowledged instead of
ignored.

This matters because the check channel is normally outside `CHANNEL_ID`, so
ordinary conversation replies never reach it: without this, Sakura would simply
go silent the moment a check closed.

If the follow-up is itself a decided answer, it gets the matching reply rather
than small talk: switching from dry to wet (or back) gets the matching reply, and
**not wearing one** gets the protection reminder. Anything else gets a warm free-form reply.

That free-form reply is the one place a member's own words reach the chat model,
bounded to that single message and the previous answer, exactly as the classifier
already is. No records, history, counts or identities are sent. With the AI
unavailable, a fixed acknowledgement is used. Past the window or the reply cap,
the channel goes back to ordinary handling.

## Asking on demand

An administrator can start a check at any time with
**`/diapercheck ask member:@someone`**. Discord hides the command from
non-administrators, and MommyBot rechecks the caller's live Administrator
permission before acting, so a stale permission cache cannot authorize it.

The reply is private. The check is posted in the server's check channel exactly
like a random check, and pushes that server's next random check two to four
hours out.

Because an administrator asking is deliberate and immediate, this is the one
check that **ignores silent hours**. It still respects the opt-in role and LiDollID
verification: a member without them, or who has left, is refused with a note rather than asked. A member
who already has a question waiting is not asked twice.

## Silent hours

No new question is posted between **22:00 and 06:00** in the bot host's own time
zone. A question that becomes due during quiet hours is saved and asked once quiet
time ends; it is abandoned if it could not be delivered within its own one-hour
answer window. Answers and follow-ups are still processed during quiet hours.

## Configuration

Diaper checks need no bridge URL or token. Restart MommyBot after changing settings.

| Setting | Behavior |
| --- | --- |
| `DIAPER_CHECKS_ENABLED=true` | Required. Also requires `LIDOLLID_ENABLED=true`, since only LiDollID-verified members are asked. |
| `DIAPER_CHECKS_DB` | Check journal location. Defaults to `data/diaperchecks.db`. |
| `DIAPER_CHECKS_AI_ENABLED=false` | Use standard wording and treat every non-direct answer as unclear. AI wording is enabled by default. |
| `DIAPER_CHECKS_AI_TIMEOUT_MS` | AI wait limit, 1,000-15,000 milliseconds. Defaults to 8,000. |

MommyBot looks for a due server once a minute.

Prose uses the existing `LLAMA_BASE_URL`, `LLAMA_MODEL` and MommyBot system
prompt. Classification uses `ROUTER_LAMA_URL` and `ROUTER_MODEL` (falling back to
`LLAMA_MODEL`) at temperature zero, exactly as the swear jar does. The classifier
receives the member's single message alone, with no history, records or identity.

Startup prints `[Diaper check] ON` or `OFF` with the reason.

## Persistence and recovery

The check journal at `data/diaperchecks.db` holds open questions, the rotation's
call log and each server's next check time. Questions are journaled before Discord is contacted, so
a failed send is retried on the next pass rather than lost, and a delivered
question is never asked twice. Answers are journaled before the follow-up is sent,
so an outage during the reply retries the reply and not the question.

Tables left over from the retired Littlepottchi accident checks are dropped on startup.
Finished checks are pruned after thirty days; this is not intended as a permanent
record of anyone's accidents.
