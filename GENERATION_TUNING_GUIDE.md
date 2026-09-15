# MommyBot generation tuning

## Clothing rolls and care

Expanded clothing rarity defaults are assigned by the importer; existing edited
rarities remain preserved by ID. Tier probabilities remain fixed as new designs
join the pool, so per-design odds decrease within growing tiers. The import report
distinguishes wearable designs from faded previews and shared garment sections.
Ordinary underwear is excluded, leaving 949 designs across 12 clothing slots.
Keep the underwear slot disabled in the editor and validator; diapers and training
pants are supplied by Atelier and retain their independent bulk and stance tuning.

Littlepottchi has authored UI and care rules, with no generated dialogue or image
generation at runtime. Clothes Emporium draws rarity then a uniform design using
server randomness. Tune rarity and fit in `assets/dressup/catalog.json` or
`python/game_editor_gui.py`, keeping every tier populated. A diaper's saved stance
selects the actual body base automatically. See [DRESSUP_GUIDE.md](DRESSUP_GUIDE.md).

## Conversational routing

`src/graph/router.js` decides whether ordinary chat merits a reply. Direct
mentions, Discord replies to Sakura (including replies with ping disabled), DMs
and an opening address by name bypass the model. Replies/mentions aimed at
other members, bot commands, link-only posts and plain closing acknowledgements
stay quiet. Short answers to her recent question can continue without a ping.
Complete acknowledgements such as "that helped, thank you" also close a turn;
gratitude with a new question or concern still goes to the classifier. Two
recent turns between this member and another human stay their conversation
unless the latest message directly addresses Sakura or openly invites company
(for example, "can anyone help?"). These checks avoid relying on model politeness
to decide whether to interrupt or add another "you're welcome".
The existing `CHANNEL_ID` gate still controls which channels reach chat routing.

The classifier receives up to 12 recent messages from this channel, covering
five minutes, with speaker labels, ages, mentions and the reply target. History
reads have a 1.5-second limit and fall back to the channel cache. Missing
history permissions reduce context; they do not disable direct addresses.
Old per-member memory is retained for chat but never used as proof that a
channel conversation is still active. Recent-question shortcuts expire after
two minutes and apply only to the intended member.

`ROUTER_LAMA_URL` remains the router endpoint; optional `ROUTER_MODEL` overrides
`LLAMA_MODEL` for classification. Temperature is zero, thinking is disabled,
and the 64-token response has no whitespace stop tokens. The decision must be
a complete respond/skip label. Blank, reasoning-only, malformed, timeout and
HTTP-error responses stay quiet. Direct addresses still work during a router
outage. Each route logs a reason without logging the private model output.

Run `node scripts/check-router.mjs /path/to/mommybot.env` to evaluate the actual
model on 17 synthetic exchanges without posting to Discord. This is a small
regression set, not a guarantee of conversational judgement. Add anonymized
examples to `scripts/fixtures/router-conversations.json` when tuning the prompt.

## Prism Drop

Prism Drop uses authored UI text and cryptographically random server bounces;
it does not call an LLM. Its canvas adds cosmetic particle randomness only.
Payouts and saved paths live in `src/balldrop/`; never let generated copy choose
an outcome or claim a pending credit has arrived. See [BALLDROP_GUIDE.md](BALLDROP_GUIDE.md).

Each new wager shuffles blocked pegs, bombs and coins using `OBSTACLE_COUNTS`
and `randomObstacles()` in `rules.js`. Entry pins, bounces, bomb launches and
1-5 coin rewards are also resolved freshly on the server. Never regenerate a
layout while reading state, replaying an animation or retrying payment.
Saved hits drive sparks, gold pickup labels and result summaries. Cosmetic
randomness cannot change rewards. Keep landing returns, peg bonuses and pending
payment wording distinct and accurate.

Sound effects are locally synthesized in `src/balldrop/web/sound.js`. The saved
collision type selects each cue; no generated speech, remote media or model
call is involved. Tune note frequencies, envelopes and the master gain there.

## Little Log nightly reports

Nightly report Markdown is generated upstream and attached in full by
`src/reports/publisher.js`. Tune prompts and output limits in Little Log's admin
console. MommyBot does not rewrite reports or invoke its chat model; its fixed
caption marks model authorship and output-limit status. Manual analyses never
enter the feed. See [NIGHTLY_REPORTS_GUIDE.md](NIGHTLY_REPORTS_GUIDE.md).

## New-member welcome messages

`src/graph/welcomeMessage.js` generates a brief greeting through
`WELCOME_AI_BASE_URL`, defaulting specifically to `http://192.168.1.250:9090/v1`.
It uses `LLAMA_MODEL` and the shared persona/address rule with temperature `0.8`,
`max_tokens: 192`, and thinking disabled. No member names, IDs or history enter
the request. The application appends the newcomer mention, verified rules link,
LiD0llID browser approval and Discord confirmation instructions.

`WELCOME_AI_TIMEOUT_MS` defaults to 8,000 and accepts 1,000–15,000 milliseconds.
`WELCOME_AI_ENABLED=false` uses the standard welcome. Inference errors, empty or
oversized text, incomplete reasoning, links, mentions and masculine address also
use that fallback. Adjust warmth in the generation prompt; keep exact onboarding
instructions and role-delivery claims in application code. See
[WELCOME_GUIDE.md](WELCOME_GUIDE.md).

## Player transfers

Send-coin and send-diamond prompts are authored in `src/auth/menu.js`; outcomes
come from `src/wallet/commands.js` and the durable transfer journal. The model
does not choose recipients, approve transfers, calculate amounts or generate
payment status. Keep review wording explicit that the sender pays from her own
balance, and keep stars excluded from player transfers.

## Coin leaderboard

The Coin Garden page in `src/leaderboard/web/` uses authored text and verified
online coin reads. It does not call the model. Adjust its HTML/CSS for wording
and appearance; keep player names, balances and rankings out of AI prompts.
Ranks and unavailable-wallet states are calculated by application code.

## Swear-jar replies

`src/graph/swearJarMessage.js` calls the existing chat AI server for a warm,
playful reminder or a lottery celebration. `LLAMA_BASE_URL` selects the chat
server, `LLAMA_MODEL` selects the model, and `SYSTEM_PROMPT` supplies MommyBot's
established voice. The router server does not generate these notices.

All member-facing AI prompts append a shared rule from `src/graph/prompt.js`:
members are girls, groups are addressed as girls, and member pronouns are she/her.
The rule follows any custom `SYSTEM_PROMPT`, so an existing Fedora persona does
not remove it. It applies to ordinary chat, GitHub announcements and swear-jar
generation. Swear-jar output containing masculine address or pronouns is rejected
and uses the standard feminine notice instead. Both the reminder and lottery
fallbacks address the recipient as a sweet girl.

The request uses temperature `0.8`, a `192`-token output limit and
`chat_template_kwargs.enable_thinking=false`. It requests one or two short
sentences and sends only whether this is a swear reminder or a lottery notice.
Original Discord messages, chat history, account identifiers and balances are
excluded. The model writes friendly prose; application code supplies payment
facts, required account/login guidance, winner mentions and live jar totals.

`SWEAR_JAR_AI_TIMEOUT_MS` accepts 1,000–15,000 milliseconds, defaulting to 8,000.
Use `SWEAR_JAR_AI_ENABLED=false` to pause generation while keeping standard
swear-jar notices, balances and payments active. Restart after changing settings.
On Fedora, edit `/etc/mommybot/mommybot.env`; checkout `.env` changes do not
update that service file.

Closed thinking blocks are removed. Empty, incomplete-thinking, oversized,
mention-bearing, numeric or linked output falls back to the standard notice,
as do HTTP errors and timeouts. Keep the generated line under 500 characters.
Never let a wording change move money, choose winners or calculate jar balances.
The application refreshes the payment state and server totals after generation,
so simultaneous fines or payment retries are reflected before the notice sends.

Use `node --test test/swear-jar-ai.test.js test/swear-jar.test.js` to verify
generation and balance behavior without contacting live model or wallet servers.
The runtime checker in [DEPLOYMENT_FEDORA.md](DEPLOYMENT_FEDORA.md) checks model
reachability; it does not validate the quality of generated text.

## Littlepottchi wetting and timed care

The creator's supported anatomy comes from `CW/Body`: chest overlay, two nipple
styles, five penis styles and three pubic-hair styles, plus the vulva region in
Base_1. Catalog `appearance` entries hold validated layers and bare camera IDs.
Keep the supplied 387×875 registration (pubic hair scales down from 1548×3500).
Covered chest/genital regions are suppressed to prevent clothing clipping.
Use the editor's **Preview character anatomy** window to check both body shapes
and stances. Gender remains independent and never changes these mappings.

Fresh Change cards use each diaper's catalog image, alpha bounds, bulk and stance.
Use the fit editor to check these values; do not bake text or stats into images.
Food cards use imported collectible images and catalog fullness/joy values.
Toy cards read session duration/relief from the server snapshot. Menu illustrations
and layout are deterministic browser code, with no image generation at runtime.

Discord `/doll` exports compose the saved asset layers into a transparent PNG at
387 × 875; they do not generate new artwork. Keep `web/layers.js` as the common
browser/export layer order when tuning split hair, garment parts or stance.
Public diaper status is fixed text derived from that same saved snapshot.

The pastel browser theme is authored in `src/dressup/web/pastel.css`: dotted
background, doll frame, colored action tiles, meter fills and picture-card states.
Tune its palette independently of the asset catalog or PNG export. Headings use
local playful fonts, and reduced-motion preferences disable button movement.

Excitement tuning lives in `src/dressup/excitement.js`: maximum 255, buildup
12/hour, and per-toy duration/relief. Each session pauses buildup and gradually
applies relief; stopping grants only elapsed relief. All adult dolls use the
same rules regardless of gender. The editor's **View excitement & toy rules**
button reads these shipping values. Restart the server after editing them.

`BABYWIPES_PRICE` controls the per-wipe coin price (default 1); new purchases pin
their price before payment. Each wipe clears all body cleanup from diaper-free
accidents and leaks. Tune diaper camera arrays in the catalog; first frame stays
clean and all later frames require messy mode. The editor previews these frames.

Tune `messyRules` in `src/dressup/care.js`: `minInterval` is 10 hours, `maxInterval`
is 14 hours, and bulk cost is 1 per messy accident, matching wettings. Each interval is sampled uniformly
in milliseconds, including both endpoints. Existing deadlines are preserved.
Update its UI label when changing the range. This is
authored timing; the current saved AI input does not include bowel-event counts.

Overflow follows lidollquest: reaching capacity caps comfort at 35; each new
accident above it has 10% leak chance per excess bulk, capped at 100%. See
`overflowRules` in `src/dressup/care.js`. Keep wet and messy accidents at one unit
each. A leak requires a wipe; contained overflow does not. Changes in tuning
do not reroll old accidents or erase saved cleanup requirements.

Diaper bulk is a separate integer capacity (1�100 wettings) in assets/dressup/catalog.json; the wardrobe editor can tune it without changing the reviewed stance. The asset importer preserves edited bulk. Care durations and need periods are in src/dressup/care.js; pantry fullness/joy values are in the catalog. Rhythm comes from the latest saved community AI counts, with a labeled four-hour fallback. See LITTLEPOTTCHI_API.md.
