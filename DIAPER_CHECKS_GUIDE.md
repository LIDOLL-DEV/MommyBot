# MommyBot's diaper checks

MommyBot reads Littlepottchi's own accident state for members who have opted in, asks them in Discord whether they need a change, and gently chastises
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

MommyBot reads **Littlepottchi care state directly, in process**. Littlepottchi is
MommyBot's own game, so there is no network call, no bridge URL and no credential
involved: each pass reads every saved player's current diaper revision and derives
an accident from `care.leaking`, `care.mess` or `care.wetness`, in that order.

Only players who have actually opened Littlepottchi are scanned, and only those
whose verified LiD0llID identity matches a confirmed Discord link. A browser-only
game account with no Discord link is skipped.

**Using a diaper never tags the member who used it.** It only records that they
are due to be asked. MommyBot then picks one member who has used their diaper
**within the last four hours** and asks them, so a check never arrives the instant
someone has an accident. After four hours an unattended accident stops counting.

This is deliberately **not** the `/littlepottchi/integration/v1/events` feed that
MommyBot serves to Little Log. That feed exists for Little Log's push bridge: it
only contains events for players who enabled *Receive pet reminders through Little
Log*, and reading it marks entries acknowledged.

Each accident is keyed by the member and the moment it was first seen, so the same
accident is never asked about twice, even after a question expires unanswered.

## Fresh diapers

When a member's diaper revision changes after a soiled one, they have put on a
fresh diaper. MommyBot praises them in the check channel, using the wording their
pronoun role calls for: **good girl** for she/her, **good boy** for he/him, and
**good little one** otherwise, exactly as every other address in the bot works.

Praise is a moment rather than a question. It never occupies the one open check
slot, is never queued for later, and is given once per change. A change during
quiet hours is simply not announced rather than announced hours late.

**A change within fifteen minutes of the accident settles it.** That member is no
longer asked about the accident at all: the fresh diaper has already answered the
question, so they get praise instead of a check. A change that comes later still
earns praise, but the check is still asked.

## Random checks

If a participating member has gone a full random window of **six to twelve hours**
without any check, they become due. MommyBot picks one due member at random,
rather than always asking whoever has waited longest, and asks them for a status
update. Every check of any kind redraws that member's window.

A newly eligible member waits a full window before their first check, so enabling
the feature does not immediately ping everyone.

## One at a time, and everyone in turn

A server only ever has **one open question**. While a member has been asked and
has not answered, no other member is asked, whether by accident, at random or on
demand. Checks additionally leave a **30-minute gap** after the previous one in
that server, so answering quickly does not immediately summon the next person.

Who gets asked is a **rotation, not a raffle**. MommyBot logs every member it has
called, and always draws from those called fewest times, at random among ties. So
everyone eligible is asked once before anyone is asked a second time. The call log
is durable, so a restart does not reset the rotation.

Members who have used their diaper in the last four hours are always preferred
over a routine status check; the rotation applies within whichever group is being
drawn from.

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

## Continuing the conversation

A closed check does not end the exchange. For **15 minutes** afterwards, up to
**four** more messages from that member in the check channel get a reply, so
saying *"I changed five minutes ago"* after answering is acknowledged instead of
ignored.

This matters because the check channel is normally outside `CHANNEL_ID`, so
ordinary conversation replies never reach it: without this, Sakura would simply
go silent the moment a check closed.

If the follow-up is itself a decided answer, it gets the matching reply rather
than small talk: **yes** is praised as a correction, and **not wearing one** gets
the protection reminder. Anything else gets a warm free-form reply.

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

Diaper checks need no bridge URL or token. Restart MommyBot after changing settings.

| Setting | Behavior |
| --- | --- |
| `DIAPER_CHECKS_ENABLED=true` | Required. Also requires `LIDOLLID_ENABLED=true`, so care state can be matched to Discord members, and Littlepottchi itself must be available. |
| `DIAPER_CHECKS_DB` | Check journal location. Defaults to `data/diaperchecks.db`. |
| `DIAPER_CHECKS_AI_ENABLED=false` | Use standard wording and treat every non-direct answer as unclear. AI wording is enabled by default. |
| `DIAPER_CHECKS_AI_TIMEOUT_MS` | AI wait limit, 1,000-15,000 milliseconds. Defaults to 8,000. |

Care state is scanned once a minute.

Prose uses the existing `LLAMA_BASE_URL`, `LLAMA_MODEL` and MommyBot system
prompt. Classification uses `ROUTER_LAMA_URL` and `ROUTER_MODEL` (falling back to
`LLAMA_MODEL`) at temperature zero, exactly as the swear jar does. The classifier
receives the member's single message alone, with no history, records or identity.

Startup prints `[Diaper check] ON`, `OFF` or `MISCONFIGURED` with the reason.
A misconfiguration message names only the offending field, never its value.

## Persistence and recovery

The check journal at `data/diaperchecks.db` holds seen episode keys, open questions
and per-member scheduling. Questions are journaled before Discord is contacted, so
a failed send is retried on the next pass rather than lost, and a delivered
question is never asked twice. Answers are journaled before the follow-up is sent,
so an outage during the reply retries the reply and not the question.

Seen episode keys are pruned after seven days, long after their care revision has moved on.
Finished checks are pruned after thirty days; this is not intended as a permanent
record of anyone's accidents.
