# NPC dialogue notes

Prism Drop has fixed instructions and result text in `src/balldrop/web/app.js`.
There is no NPC conversation or modding GUI for this game. Keep exact landing,
gross return, rounded payouts and pending-credit wording tied to server state;
cosmetic replay must not announce a new payment. See [BALLDROP_GUIDE.md](BALLDROP_GUIDE.md).

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
