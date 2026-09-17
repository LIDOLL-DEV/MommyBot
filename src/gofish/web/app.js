const $ = id => document.getElementById(id);
const RANKS = "A23456789TJQK", SUITS = { S: "♠", H: "♥", D: "♦", C: "♣" };
const LABELS = { A: "A", T: "10", J: "J", Q: "Q", K: "K" };
const NAMES = { A: "Aces", 2: "Twos", 3: "Threes", 4: "Fours", 5: "Fives", 6: "Sixes", 7: "Sevens", 8: "Eights", 9: "Nines", T: "Tens", J: "Jacks", Q: "Queens", K: "Kings" };
const label = rank => LABELS[rank] || rank;
let data = null, busy = false, timer = null;
const format = value => Number(value).toLocaleString();
function notice(text = "") { $("notice").textContent = text; $("notice").hidden = !text; } // Announce failures without using HTML or leaving a silent loading state.

async function api(path, input) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/gofish/api/${path}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(input ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": data?.csrf || "" }, body: JSON.stringify(input) } : {}) });
    let result; try { result = await response.json(); } catch { throw new Error("The server did not return a game response. Refresh to check any pending payment."); }
    if (!response.ok) {
      if (response.status === 401) { data = null; $("table").hidden = true; $("logout").hidden = true; $("balance").textContent = "—"; }
      throw new Error(result.error || "The game could not finish this action.");
    }
    return result;
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError) throw new Error("The connection was interrupted. Refresh and retry any pending payment; don't start a replacement game.");
    throw error;
  } finally { clearTimeout(timeout); }
} // Bound requests and keep the browser free of wallet grants and user-controlled account IDs.

function card(value, faceDown = false) {
  const element = document.createElement("span");
  if (faceDown) { element.className = "card back"; return element; }
  const rank = value[0], suit = value[1];
  element.className = `card${suit === "H" || suit === "D" ? " red" : ""}`;
  element.append(label(rank), Object.assign(document.createElement("small"), { textContent: SUITS[suit] }));
  element.setAttribute("aria-label", `${NAMES[rank]} card`);
  return element;
} // Build cards from server-sent values only; the pond and the opponent's hand are never known here.

function controls() {
  if (!data) return;
  const game = data.game, playing = game?.status === "active", mine = Boolean(game?.yourTurn);
  const poor = data.coins !== null && data.coins < data.price;
  let reason = busy ? "Your game is finishing a request…" : data.pending ? "Finish your saved payment with Retry payment above." : "";
  if (!reason && !data.enabled) reason = "New games are paused. Games in progress and pending payments still work.";
  if (!reason && !playing && poor) reason = `You need ${data.price} LiDollcoin to play the computer. Friend games are still free.`;
  $("play-solo").disabled = busy || Boolean(data.pending) || !data.enabled || poor;
  for (const id of ["make-code", "make-open", "join"]) $(id).disabled = busy || !data.enabled;
  for (const button of $("hand").children) button.disabled = !playing || !mine || busy || Boolean(data.pending);
  for (const id of ["leave", "retry", "refresh", "logout", "cancel-wait"]) $(id).disabled = busy;
  for (const button of $("lobby-list").children) button.querySelector("button").disabled = busy || !data.enabled;
  $("board-note").textContent = reason; $("board-note").hidden = !reason;
} // Explain disabled controls and never leave a turn button live while a move or payment is unresolved.

function renderHand(game) {
  $("hand").replaceChildren();
  const groups = new Map();
  for (const value of game.you.hand) groups.set(value[0], [...(groups.get(value[0]) ?? []), value]);
  for (const rank of RANKS) {
    if (!groups.has(rank)) continue;
    const button = document.createElement("button");
    button.type = "button"; button.className = "rank-stack"; button.dataset.rank = rank;
    button.setAttribute("aria-label", `Ask for ${NAMES[rank]} — you hold ${groups.get(rank).length}`);
    const stack = document.createElement("span"); stack.className = "stack";
    for (const value of groups.get(rank)) stack.append(card(value));
    button.append(stack, Object.assign(document.createElement("span"), { className: "ask-label", textContent: `Ask for ${NAMES[rank]}` }));
    button.addEventListener("click", () => act("ask", { rank }));
    $("hand").append(button);
  }
  if (!game.you.hand.length) $("hand").append(Object.assign(document.createElement("p"), { className: "muted fine", textContent: "Your hand is empty — the pond is empty too, so this game is over." }));
} // Ask by rank, the way the game is played aloud, instead of by individual card.

function renderBooks(target, ranks) {
  $(target).replaceChildren();
  if (!ranks.length) { $(target).append(Object.assign(document.createElement("span"), { className: "muted fine", textContent: "None yet" })); return; }
  for (const rank of ranks) $(target).append(Object.assign(document.createElement("span"), { className: "book", textContent: NAMES[rank] }));
}

function render() {
  if (!data) return;
  $("table").hidden = false; $("logout").hidden = false;
  $("balance").textContent = data.coins === null ? "—" : format(data.coins);
  $("greeting").textContent = `Welcome to the card pond, ${data.username}.`;
  $("played").textContent = format(data.totals.played); $("won").textContent = format(data.totals.won); $("total-earned").textContent = format(data.totals.earned);
  $("pending").hidden = !data.pending;
  if (data.pending) $("pending-copy").textContent = data.pending.action === "create" ? `Your ${data.price}-coin entry is waiting for confirmation. Retry opens the same table.` : `Your ${data.pending.amount}-coin book reward is saved. Retry will confirm it once.`;
  const game = data.game, waiting = game?.status === "waiting", playing = game?.status === "active";
  $("welcome").hidden = Boolean(game && game.status !== "finished" && game.status !== "forfeited");
  $("lobby-panel").hidden = Boolean(waiting || playing);
  $("waiting").hidden = !waiting;
  $("board").hidden = !game || waiting;
  $("lobby").hidden = !data.lobby.length;
  $("lobby-list").replaceChildren(...data.lobby.map(entry => {
    const item = document.createElement("li"), join = document.createElement("button");
    join.type = "button"; join.className = "quiet"; join.textContent = "Join";
    join.setAttribute("aria-label", `Join the table opened by ${entry.host}`);
    join.addEventListener("click", () => act("join", { game: entry.id }));
    item.append(Object.assign(document.createElement("span"), { textContent: entry.host }), join);
    return item;
  })); // Open tables are listed by the display name their host is already signed in with.
  if (waiting) {
    $("waiting-title").textContent = game.visibility === "open" ? "Your table is on the open list…" : "Waiting for your friend…";
    $("waiting-copy").textContent = game.code ? "Share this code. The table stays open for half an hour." : "Anyone signed in can join this table from their own Go Fish page.";
    $("code-value").textContent = game.code || "Open table";
    $("copy-code").hidden = !game.code;
  }
  if (game && !waiting) {
    $("opponent-name").textContent = game.them.name;
    $("opponent-cards").textContent = `${game.them.cards} ${game.them.cards === 1 ? "card" : "cards"} in hand · ${game.pond} in the pond`;
    $("opponent-backs").replaceChildren(...Array.from({ length: Math.min(game.them.cards, 10) }, () => card(null, true)));
    $("pond-count").textContent = format(game.pond);
    renderBooks("their-books", game.them.books); renderBooks("your-books", game.you.books);
    renderHand(game);
    $("log").replaceChildren(...game.log.map(text => Object.assign(document.createElement("li"), { textContent: text })));
    $("turn-banner").className = `turn-banner${game.yourTurn ? " mine" : ""}`;
    $("turn-banner").textContent = playing ? (game.yourTurn ? "Your turn — ask for a rank you're holding." : `Waiting for ${game.them.name} to ask…`)
      : game.result === "won" ? `You win, ${game.you.books.length} books to ${game.them.books.length}! 🐟`
      : game.result === "lost" ? `${game.them.name} wins, ${game.them.books.length} books to ${game.you.books.length}. Another game?`
      : game.result === "left" ? "You left this game." : game.result === "tie" ? "A perfect tie!" : `${game.them.name} left the game — the win is yours.`;
    $("leave").hidden = !playing;
    $("board-title").textContent = playing ? "Your hand — tap a rank to ask for it" : "How the hands finished";
  }
  controls(); schedulePoll();
} // Paint only the server's view of your own hand; opponent cards arrive as counts and never as values.

function schedulePoll() {
  clearTimeout(timer); timer = null;
  const game = data?.game;
  const watching = game && (game.status === "waiting" || (game.status === "active" && game.mode === "friend" && !game.yourTurn));
  if (!watching || document.hidden || busy) return;
  timer = setTimeout(async () => {
    if (busy || document.hidden) { schedulePoll(); return; }
    try { const fresh = await api("state?wallet=0"); data = { ...data, ...fresh, coins: data.coins, walletError: data.walletError }; render(); }
    catch { schedulePoll(); } // A dropped poll is not an error the player needs to see; the next one recovers.
  }, 4000);
} // Watch only while the other seat is deciding, skipping the wallet so a quiet table costs nothing.

async function refresh() { const fresh = await api("state"); data = fresh; render(); }
function requestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join("");
} // Keep request IDs secure on browsers without randomUUID.

function summarize(result) {
  if (result.action === "create") return result.snapshot.game?.status === "waiting" ? "Your table is ready. Share the code with your friend!" : "Your cards are dealt. Good luck!";
  if (result.action === "join") return "You're in! Cards are dealt.";
  if (result.action === "leave") return "You left the table. Earned coins stay yours.";
  if (result.action !== "ask") return "Done.";
  const books = result.books?.length ? ` You completed ${result.books.map(rank => NAMES[rank]).join(" and ")}${result.amount ? ` — +${result.amount} LiDollcoins!` : "!"}` : "";
  if (result.got) return `They had ${result.got} ${NAMES[result.asked]}! Ask again.${books}`;
  return result.wish ? `Go fish — and you fished a ${NAMES[result.asked].replace(/e?s$/, "")}! Ask again.${books}` : `Go fish. No ${NAMES[result.asked]} this time.${books}`;
} // Describe your own move in plain words; the log keeps the shared history for both players.

async function act(action, extra = {}) {
  if (busy || !data) return;
  busy = true; notice(); controls(); clearTimeout(timer);
  let submitted = false;
  try {
    const input = { action, request: requestId(), ...extra };
    submitted = true;
    const result = await api("action", input);
    data = { ...data, ...result.snapshot }; render();
    const message = summarize(result);
    notice(message);
    try { await refresh(); } catch { notice(`${message} The action completed; press Refresh to update your balance.`); }
  } catch (error) {
    notice(submitted ? error.message : "The browser could not prepare the request. Nothing was sent. Refresh and try again.");
    if (submitted) try { await refresh(); } catch { /* Preserve the original diagnostic while the connection is unavailable. */ }
  } finally { busy = false; controls(); schedulePoll(); }
} // A lost response reconciles saved state; retries resume the original journal instead of dealing a new table.

$("play-solo").addEventListener("click", () => act("create", { mode: "solo" }));
$("make-code").addEventListener("click", () => act("create", { mode: "friend", visibility: "code" }));
$("make-open").addEventListener("click", () => act("create", { mode: "friend", visibility: "open" }));
$("join-form").addEventListener("submit", event => { event.preventDefault(); const code = $("join-code").value.trim(); if (code) act("join", { code }); });
$("retry").addEventListener("click", () => act("retry"));
$("cancel-wait").addEventListener("click", () => act("leave"));
$("leave").addEventListener("click", () => {
  $("leave-copy").textContent = data?.game?.mode === "solo" ? "Coins you've already earned stay yours. The entry coin isn't refunded." : "Your friend will be shown as the winner. No coins are involved in a friend game.";
  $("leave-dialog").showModal();
});
$("leave-cancel").addEventListener("click", () => $("leave-dialog").close());
$("leave-confirm").addEventListener("click", () => { $("leave-dialog").close(); void act("leave"); });
$("copy-code").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("code-value").textContent); notice("Invite code copied. Send it to your friend!"); }
  catch { notice("Copying isn't available here — read the code out or type it in yourself."); }
});
$("refresh").addEventListener("click", async () => { if (busy) return; busy = true; controls(); try { await refresh(); notice(data.walletError || ""); } catch (error) { notice(error.message); } finally { busy = false; controls(); } });
$("logout").addEventListener("click", async () => { if (busy) return; busy = true; controls(); try { await api("logout", {}); data = null; location.reload(); } catch (error) { notice(error.message); } finally { busy = false; controls(); } });
document.addEventListener("visibilitychange", () => { if (!document.hidden) schedulePoll(); });

const invited = new URLSearchParams(location.search).get("code");
refresh().then(async () => {
  if (data.walletError) notice(data.walletError);
  if (!invited) return;
  history.replaceState(null, "", "/gofish/"); // Consume the invite once so a reload cannot try to join twice.
  if (data.game && data.game.status !== "finished" && data.game.status !== "forfeited") { notice("You already have a game in progress. Finish or leave it to join another table."); return; }
  $("join-code").value = invited; await act("join", { code: invited });
}).catch(error => notice(error.message));
