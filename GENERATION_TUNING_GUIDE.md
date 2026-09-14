# MommyBot generation tuning

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
