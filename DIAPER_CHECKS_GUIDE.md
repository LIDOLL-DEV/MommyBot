# MommyBot's diaper checks

MommyBot reads Little Log's Littlepottchi accident records for members who have
opted in, asks them in Discord whether they need a change, and gently chastises
a member who denies an accident the records show. Members who have not been
checked for six to twelve hours get a random status request instead.

Every question is one mention plus a short AI-written line. MommyBot appends the
exact answer instructions. No record, count, time or message text is ever sent to
the AI, and nothing about a member's records is ever quoted in the channel.

## Opting in

Diaper checks are off until a server administrator enables them in the admin
panel and chooses both a **check channel** and a **participating role**.

The channel must **not** be visible to `@everyone`; the panel refuses a public
one, because these questions are personal. The role is the opt-in: only members
holding it are ever asked, for accident checks and random checks alike. Removing
the role stops checks immediately, including for a question already waiting to be
sent. Leaving the server has the same effect.

## Accident checks

MommyBot polls the Littlepottchi integration feed for `wet`, `mess` and `leak`
events. Each event carries the verified LiD0llID issuer and subject, which is
matched against confirmed Discord links. An unlinked Little Log account has no
Discord member to ask and is skipped.

Each event is journaled by its own ID the first time it is read, so a member is
asked about a given accident exactly once, even across restarts. A member has at
most one open question at a time: a second accident while one is pending does not
stack another prompt.

MommyBot **reads this feed without acknowledging it**. Little Log's own push
bridge keeps its full delivery queue, so running both is safe. MommyBot tracks its
own cursor and its own seen-event journal instead.

## Random checks

If a participating member has gone a full random window of **six to twelve hours**
without any check, they become due. MommyBot picks one due member at random per
server per pass, rather than always asking whoever has waited longest, and asks
them for a status update. Every check of either kind redraws that member's window.

A newly eligible member waits a full window before their first check, so enabling
the feature does not immediately ping everyone.

## Answers

MommyBot reads the member's next message in the check channel. **yes**, **yeah**,
**yep**, **mhm**, **no**, **nope** and **nah**, with or without addressing Mommy,
are recognized directly without a model request, as are the "not wearing one"
wordings below. Other wording goes to the router classifier, which answers yes,
no, undiapered or unclear.

| Answer | Result |
| --- | --- |
| Yes | Warm praise for the honesty and a nudge to get changed. |
| No, after a recorded accident | A gentle **fibbing to Mommy** notice, and a `diaper-check.denied` entry in that server's admin journal. |
| No, on a random or admin check | Simply thanked; those checks have no record to contradict. |
| Not wearing one | A gentle **not wearing your protection** notice asking them to go and put a fresh one on. |
| Unclear | One request for a plain yes or no. Further unclear messages go to ordinary conversation. |

**Not wearing one** covers the natural variations directly, without a model
request: *I'm not wearing a diaper*, *no diaper right now*, *not wearing one*,
*without a nappy*, *I don't have one on*, *I'm diaper free*, *not diapered*,
*I took it off*, and being in ordinary or big-kid underwear. Other phrasings go
to the classifier, which has this as a fourth label.

It outranks yes and no in the same message, so *"yes but I'm not wearing a
diaper"* gets the protection reminder rather than the accident reply. Going
without is not treated as lying: it is never recorded in the admin journal and
never produces a fibbing notice. Wearing one is never misread as the opposite,
so *"I'm diapered"* and *"no one is home"* are unaffected.

A denial costs no coins and is never announced beyond the reply itself. The
journal entry records the member's Discord ID and the event kind for server
administrators only.

An **unreachable classifier never returns "no"**, so an AI outage can never cause
someone to be accused of fibbing. Unanswered questions expire after an hour, are
not chastised for silence, and stop blocking the next check.

## Asking on demand

An administrator can start a check at any time with
**`/diapercheck ask member:@someone`**. Discord hides the command from
non-administrators, and MommyBot rechecks the caller's live Administrator
permission before acting, so a stale permission cache cannot authorize it.

The reply is private. The check is posted in the server's check channel as a
status request, exactly like a random check: there is no accident record behind
it, so answering no is simply thanked rather than treated as a fib. It resets
that member's six to twelve hour window.

Because an administrator asking is deliberate and immediate, this is the one
check that **ignores silent hours**. It still respects the opt-in role: a member
without it, or who has left, is refused with a note rather than asked. A member
who already has a question waiting is not asked twice.

## Silent hours

No new question is posted between **22:00 and 06:00** in the bot host's own time
zone. A question that becomes due during quiet hours is saved and asked once quiet
time ends; it is abandoned if it could not be delivered within its own one-hour
answer window. Answers and follow-ups are still processed during quiet hours.

## Configuration

Diaper checks reuse the Littlepottchi bridge endpoint and credential that Little
Log already issues. Restart MommyBot after changing settings.

| Setting | Behavior |
| --- | --- |
| `DIAPER_CHECKS_ENABLED=true` | Required to read the feed at all. Also requires `LIDOLLID_ENABLED=true`. |
| `LITTLEPOTTCHI_API_URL` | The integration API URL ending in `/littlepottchi/integration/v1/`. HTTPS, or HTTP only to loopback or a private IPv4 address. |
| `LITTLEPOTTCHI_BRIDGE_TOKEN` | The 32-512 character bridge token. Used for bounded GETs only; it never follows a redirect. |
| `DIAPER_CHECKS_POLL_MS` | Feed poll interval, 10,000-3,600,000 milliseconds. Defaults to 60,000. |
| `DIAPER_CHECKS_DB` | Check journal location. Defaults to `data/diaperchecks.db`. |
| `DIAPER_CHECKS_AI_ENABLED=false` | Use standard wording and treat every non-direct answer as unclear. AI wording is enabled by default. |
| `DIAPER_CHECKS_AI_TIMEOUT_MS` | AI wait limit, 1,000-15,000 milliseconds. Defaults to 8,000. |

Prose uses the existing `LLAMA_BASE_URL`, `LLAMA_MODEL` and MommyBot system
prompt. Classification uses `ROUTER_LAMA_URL` and `ROUTER_MODEL` (falling back to
`LLAMA_MODEL`) at temperature zero, exactly as the swear jar does. The classifier
receives the member's single message alone, with no history, records or identity.

Startup prints `[Diaper check] ON`, `OFF` or `MISCONFIGURED` with the reason.
A misconfiguration message names only the offending field, never its value.

## Persistence and recovery

The check journal at `data/diaperchecks.db` holds seen event IDs, open questions
and per-member scheduling. Questions are journaled before Discord is contacted, so
a failed send is retried on the next pass rather than lost, and a delivered
question is never asked twice. Answers are journaled before the follow-up is sent,
so an outage during the reply retries the reply and not the question.

Seen events are pruned after seven days, well past the feed's own 24-hour expiry.
Finished checks are pruned after thirty days; this is not intended as a permanent
record of anyone's accidents.
