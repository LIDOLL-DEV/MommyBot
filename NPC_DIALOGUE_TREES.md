# NPC dialogue notes

## Admin and community copy

The server admin panel has fixed labels and audit notices in `src/admin/`.
Starboard quotes source messages with a jump link; it does not generate dialogue.
Reaction roles are silent role changes, with admin-visible errors. Server admins
can pause new conversation, swear-jar and welcome events, while saved payments
and lotteries still recover. See [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

## Littlepottchi and Clothes Emporium

Wardrobe copy should refer to complete garments and accessories across the expanded
catalog. Only diapers and training pants are available for the inner-bottom slot;
describe their matching stance without implying either collectible was consumed.
Skirts remain available; trousers and pants do not. Training pants are still an
Atelier protection option, so do not describe them as retired clothing.

These games use fixed care labels, outfit notices and purchase results in
`src/dressup/web/app.js`; there are no NPC dialogue trees yet. Explain that the
diaper chooses the leg stance and equipped clothes adjust automatically. Do not
tell players that a garment needs a different diaper stance. Detailed frilly hems
keep their original shape, following lidollquest's rendering exceptions.
School uniforms instead fit automatically with protected trim; do not tell players
that these uniforms need a setting enabled or a separate asset-generation step.
Keep fresh-change wording matter-of-fact and payment-retry wording tied to the
saved operation. See [DRESSUP_GUIDE.md](DRESSUP_GUIDE.md).

## Sakura conversation turns

Swear-jar follow-ups run before ordinary chat. The fine notice requests a cute
"sorry mommy", "sorry mommy Sakura" or "sorry mommybot". An accepted apology
gets chat-generated warm thanks. A missing or unsuitable apology gets one generated
"act your age" reminder with those examples on the member's next message in
the same channel within fifteen minutes. Keep this gentle and avoid additional
penalties: apologizing does not refund coins. The classifier prompt lives in
`src/graph/swearJarApology.js`; reply prompts use the chat endpoint through
`src/graph/swearJarMessage.js`. Fixed fallbacks and accepted-phrase examples live
in `src/swearJar.js`. Accepted apologies cancel reminders still being generated.
The three direct phrases bypass the classifier and select positive chat wording
immediately; other candidate apologies still use the classifier.
"Sorry momma" and "sorry momma Sakura" are also direct positive matches;
longer Momma apologies use the same classifier rules as Mommy apologies.

Sakura's router distinguishes an invitation to speak from a conversation
between other members. Recent questions and their answers can continue without
repeated pings; thanks, laughter and goodbye can end the exchange. A third-person
mention of Sakura is not automatically a request to her. Keep these turn-taking
rules in `src/graph/router.js`; the chat persona stays in `src/graph/prompt.js`.

Prism Drop has fixed instructions and result text in `src/balldrop/web/app.js`.
There is no NPC conversation or modding GUI for this game. Keep exact landing,
gross return, rounded payouts and pending-credit wording tied to server state;
cosmetic replay must not announce a new payment. See [BALLDROP_GUIDE.md](BALLDROP_GUIDE.md).

Block, bomb and coin-peg notices are fixed canvas status messages. Use saved
hits and pickup amounts, and keep the landing-return/bonus breakdown accurate.
A replayed gold sparkle is not a newly earned coin. Field captions distinguish
a new shuffled wager from a saved field; do not describe the displayed history
as a preview of the next drop. Keep the gentle tracker-inspired voice.

Prism Drop now has nonverbal synthesized sounds. Keep text results and pending
payment notices complete for muted players; a sound never replaces a notice.

Little Log nightly reports are upstream model-authored Markdown attachments
with a fixed date/ID and completeness caption in `src/reports/publisher.js`.
Report text never controls bot actions or mentions. See
[NIGHTLY_REPORTS_GUIDE.md](NIGHTLY_REPORTS_GUIDE.md).

New-member welcomes are a single generated greeting followed by fixed rules and
LiD0llID onboarding instructions, not an NPC dialogue tree. Greeting generation
lives in `src/graph/welcomeMessage.js`; the authoritative steps live in
`src/welcome.js`. Keep the read-rules and Discord confirmation steps in every
fallback. Welcome messages cannot grant roles or approve registrations.

This repository does not currently define NPC dialogue trees or a
`game_editor_gui.py` modding editor. Coin Garden copy is authored directly in
`src/leaderboard/web/index.html` and `app.js`; it is not an NPC conversation or
model response. Keep display names as text and unavailable-balance explanations
consistent with [COIN_LEADERBOARD_GUIDE.md](COIN_LEADERBOARD_GUIDE.md).

Player transfers use fixed recipient, amount, review and result screens in the
account menu. Their text must state that coins/diamonds come from the sender's
own wallet. NPC or model dialogue must never authorize a send or claim a payment
completed before its journal confirms it. See [ONLINE_WALLET_GUIDE.md](ONLINE_WALLET_GUIDE.md).

## Littlepottchi wetting and timed care

Gender, physique and genital appearance are separate creator preferences.
Do not infer pronouns or gender from body shape, chest or genital choices.
Creator status text should explain saving and previews without narrating anatomy.

Keep the game dashboard terse: action names, meters and short timer status.
Timer status is for care, activities and toys; do not reveal accident countdowns
or scheduling details in either the dashboard or settings.
Put choice descriptions and care instructions inside their relevant menus. Fresh
Change copy names the selected design, bulk, stance and availability. When cleanup
is required, explain the single wipe requirement beside the confirmation control.
Closing a menu is silent and does not imply that the selected action happened.

Use “Full and uncomfortable — no leak yet” at capacity. Do not announce a leak
until the server records one. The displayed probability describes the next new
accident, not a continuous chance while waiting. On a leak, explain that one baby
wipe is required before changing; contained accidents do not require cleanup.

Discord `/doll` and `/pottchistats` are deliberately public. Use short factual
check-in copy and include the game link. Both show diaper condition, including
the PNG post; never add an accident forecast, personal tracker record, or private
login link. These responses use fixed game text and do not invoke dialogue AI.

Littlepottchi characters are adults. Describe toy actions through plain status
text such as “Wand active” and “Session complete.” Use neutral wording for every
gender; player-entered gender is text, not a dialogue command or body restriction.

For leaks and diaper-free accidents, explain that one baby wipe cleans everything
before redressing. Do not imply multiple accidents need multiple wipes. The fixed
`cleanup` reminder takes priority over leak/mess/wet messages until the doll is clean.

Messy-mode timing varies between 10 and 14 hours per accident; dialogue should not
promise a fixed 12-hour schedule.
Use gentle, factual messy-care copy: the diaper needs a fresh change. Avoid
shaming the player. The fixed `mess` reminder is superseded by a leak reminder
when shared capacity is reached; neither message includes personal tracker data.

Littlepottchi reminders use fixed, gentle game messages for wet diapers, leaks, food, water, play, rest and completion. They never quote personal tracking records or imply a medical prediction. Keep the approved message sets aligned in care.js and the Little Log service worker. See LITTLEPOTTCHI_API.md.
