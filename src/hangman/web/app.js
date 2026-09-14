const $ = id => document.getElementById(id);
let data = null, busy = false;
const format = value => Number(value).toLocaleString();
function notice(text = "") { $("notice").textContent = text; $("notice").hidden = !text; } // Announce failures without using HTML or leaving a silent loading state.

async function api(path, input) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/hangman/api/${path}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(input ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": data?.csrf || "" }, body: JSON.stringify(input) } : {}) });
    let result; try { result = await response.json(); } catch { throw new Error("The server did not return a game response. Refresh to check any pending payment."); }
    if (!response.ok) {
      if (response.status === 401) { data = null; $("game").hidden = true; $("logout").hidden = true; $("balance").textContent = "—"; }
      throw new Error(result.error || "The game could not finish this action.");
    }
    return result;
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError) throw new Error("The connection was interrupted. Refresh and retry any pending payment; don't start a replacement game.");
    throw error;
  } finally { clearTimeout(timeout); }
} // Bound requests and keep the browser free of wallet grants and user-controlled account IDs.

function controls() {
  if (!data) return;
  const active = data.round?.status === "active";
  let reason = busy ? "Your game is finishing a request…" : data.pending ? "Finish your saved payment with Retry payment above." : "";
  if (!reason && !active) reason = !data.enabled ? "New games are paused. You can still finish pending payments." : data.coins === null ? data.walletError || "Refresh to check your coin balance." : data.coins < 1 ? "You need 1 LiDollcoin to start. Stars aren't used in this game." : "";
  $("start").hidden = Boolean(active); $("start").disabled = Boolean(reason); $("start").setAttribute("aria-busy", String(busy));
  $("controls-note").textContent = reason; $("controls-note").hidden = !reason;
  $("forfeit").hidden = !active; $("forfeit").disabled = busy || Boolean(data.pending);
  $("retry").disabled = busy; $("refresh").disabled = busy; $("logout").disabled = busy;
  for (const button of $("keyboard").children) button.disabled = !active || busy || Boolean(data.pending) || data.round.guesses.includes(button.textContent);
} // Explain disabled controls and disable letters only while a guess or payment is unresolved.

function render() {
  if (!data) return;
  $("game").hidden = false; $("logout").hidden = false;
  $("balance").textContent = data.coins === null ? "—" : format(data.coins);
  $("greeting").textContent = `Welcome to your word garden, ${data.username}.`;
  $("played").textContent = format(data.totals.played); $("won").textContent = format(data.totals.won); $("total-earned").textContent = format(data.totals.earned);
  $("pending").hidden = !data.pending;
  if (data.pending) $("pending-copy").textContent = data.pending.action === "start" ? "Your 1-coin entry is waiting for confirmation. Retry opens the same word." : `Your ${data.pending.amount}-coin letter reward is saved. Retry will confirm it once.`;
  const round = data.round, active = round?.status === "active";
  $("round-label").textContent = active ? "ONE LETTER AT A TIME" : round ? "A LITTLE WORD, DISCOVERED" : "READY WHEN YOU ARE";
  $("board-title").textContent = active ? "What could it be?" : round?.status === "won" ? "You found your word!" : round ? "A little word for next time." : "What will your word be?";
  $("clue").textContent = round?.clue || "A little hint comes with every word.";
  $("letters").replaceChildren();
  for (const value of round?.letters || []) { const span = document.createElement("span"); span.className = `letter${value ? " revealed" : ""}`; span.textContent = value || "_"; $("letters").append(span); }
  $("letters").setAttribute("aria-label", round ? round.letters.map(value => value || "blank").join(" ") : "No word started yet");
  $("round-status").textContent = active ? "Read your clue, then choose a letter below." : round?.status === "won" ? "Beautiful guessing! Every letter reward is yours to keep." : round ? `The word was ${round.answer}. Your earned coins stay yours.` : "Press Play to plant your first word.";
  $("earned").hidden = !round; $("earned").textContent = round ? `${round.earned} coins earned this round ✧` : "";
  $("chances").textContent = round ? `${round.remaining} of ${data.maxMistakes} chances left` : "Six chances. You've got this.";
  for (let i = 0; i < 6; i++) $(`petal-${i}`).classList.toggle("spent", Boolean(round && i < round.mistakes));
  $("keyboard").hidden = !active;
  for (const button of $("keyboard").children) { const used = round?.guesses.includes(button.textContent); button.className = used ? round.letters.includes(button.textContent) ? "hit" : "miss" : ""; }
  $("start").textContent = round ? "Play another word · 1 coin ✧" : "Play for 1 LiDollcoin ✧";
  controls();
} // Paint only the server's masked board; secret words and reward calculations never live in browser code.

async function refresh() { data = await api("state"); render(); } // Restore the saved round on every page load or refresh.
function requestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join("");
} // Keep request IDs secure on browsers without randomUUID.
async function act(action, letter) {
  if (busy || !data) return;
  busy = true; notice(); controls();
  let submitted = false;
  try {
    const input = { action, request: requestId(), round: data.round?.id, ...(letter ? { letter } : {}) };
    submitted = true;
    const result = await api("action", input);
    data = { ...data, ...result.snapshot }; render(); // Show the confirmed board before a slower wallet balance refresh.
    const message = result.action === "start" ? "Your word is ready. Happy guessing!" : result.action === "forfeit" ? "Your word is revealed. Your earned coins stay yours." : result.amount ? `Lovely! ${result.letter} revealed ${result.amount} ${result.amount === 1 ? "letter" : "letters"}. +${result.amount} LiDollcoins!` : "That letter isn't in this word. Try another little guess.";
    notice(message);
    try { await refresh(); } catch { notice(`${message} The action completed; press Refresh to update your balance.`); }
  } catch (error) {
    notice(submitted ? error.message : "The browser could not prepare the request. Nothing was sent. Refresh and try again.");
    if (submitted) try { await refresh(); } catch { /* Preserve the original diagnostic while the connection is unavailable. */ }
  } finally { busy = false; controls(); }
} // A lost response reconciles saved state; retries resume the original journal instead of buying a new word.

for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") { const button = document.createElement("button"); button.type = "button"; button.textContent = letter; button.setAttribute("aria-label", `Guess ${letter}`); button.addEventListener("click", () => act("guess", letter)); $("keyboard").append(button); }
$("start").addEventListener("click", () => act("start")); $("retry").addEventListener("click", () => act("retry"));
$("forfeit").addEventListener("click", () => $("leave-dialog").showModal());
$("leave-cancel").addEventListener("click", () => $("leave-dialog").close());
$("leave-confirm").addEventListener("click", () => { $("leave-dialog").close(); void act("forfeit"); });
document.addEventListener("keydown", event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || $("leave-dialog").open || !/^[a-z]$/i.test(event.key) || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  const button = [...$("keyboard").children].find(item => item.textContent === event.key.toUpperCase());
  if (!$("keyboard").hidden && button && !button.disabled) { event.preventDefault(); button.click(); }
}); // Support physical keyboards without intercepting shortcuts or confirmation-dialog input.
$("refresh").addEventListener("click", async () => { if (busy) return; busy = true; controls(); try { await refresh(); notice(data.walletError || ""); } catch (error) { notice(error.message); } finally { busy = false; controls(); } });
$("logout").addEventListener("click", async () => { if (busy) return; busy = true; controls(); try { await api("logout", {}); data = null; location.reload(); } catch (error) { notice(error.message); } finally { busy = false; controls(); } });
refresh().then(() => { if (data.walletError) notice(data.walletError); }).catch(error => notice(error.message));
