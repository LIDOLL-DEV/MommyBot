const $ = id => document.getElementById(id);
const colors = ["#ff749f", "#ff9972", "#ffce70", "#d8ea76", "#89e6ae", "#5ee0e0", "#74beff", "#aa9cff", "#d68cf0", "#fa85d5"];
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let data = null, busy = false, animating = false, guess = 5, bet = 1, displayed = null, unconfirmed = null;
try { unconfirmed = JSON.parse(sessionStorage.getItem("prism-pending") || "null"); } catch { /* Storage may be unavailable; the server journal still protects pending payments. */ }
const money = amount => `${amount.toLocaleString()} ${amount === 1 ? "coin" : "coins"}`;
function notice(message = "") { $("notice").textContent = message; $("notice").hidden = !message; } // Render API diagnostics as plain text in the live status area.
function saveRequest(input) {
  unconfirmed = input;
  try { if (input) sessionStorage.setItem("prism-pending", JSON.stringify(input)); else sessionStorage.removeItem("prism-pending"); } catch { /* A restricted browser can still use the durable server journal. */ }
} // Retain the same non-secret wager ID across a lost response or reload instead of automatically creating another bet.

async function api(path, input) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/balldrop/api/${path}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(input ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": data?.csrf || "" }, body: JSON.stringify(input) } : {}) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { data = null; render(); }
      throw new Error(result.error || "The game could not complete this request.");
    }
    return result;
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError || error instanceof SyntaxError) throw new Error("Connection interrupted. Refresh or retry the saved payment before placing another bet.");
    throw error;
  } finally { clearTimeout(timer); }
} // Use only the signed-in game session and CSRF token; wallet grants never enter the browser.

function controls() {
  const locked = busy || animating;
  for (const button of [...$("pockets").children, ...$("bets").children]) button.disabled = locked || Boolean(data?.pending || unconfirmed);
  $("drop").disabled = locked || !data?.enabled || !Number.isSafeInteger(data?.coins) || data.coins < bet || Boolean(data.pending || unconfirmed);
  $("refresh").disabled = locked; $("logout").disabled = locked;
  $("replay").disabled = locked || !displayed;
  $("retry").disabled = locked || !data || !(data.pending || unconfirmed);
  $("pending").hidden = !(data?.pending || (data && unconfirmed));
  $("pending-copy").textContent = data?.pending?.action === "credit" ? `${money(data.pending.amount)} waiting to be confirmed. Your landing is already saved.` : "Your original bet is saved. Retry it without placing a second bet.";
  $("controls-note").textContent = animating ? "Follow the glow…" : busy ? "Checking your wallet…" : !data ? "Sign in to connect your wallet and place a bet." : data.pending || unconfirmed ? "Finish the saved payment before making another drop." : !data.enabled ? "New drops are paused. Saved payments can still be recovered." : !Number.isSafeInteger(data.coins) ? "Your wallet is unavailable. Refresh or sign in again." : data.coins < bet ? `You need ${money(bet)} for this bet.` : `Drop spends ${money(bet)}. Your selection locks when you press it.`;
  for (const button of $("recent").querySelectorAll("button")) button.disabled = locked;
} // Explain every disabled wager control and keep replay separate from paid actions.

function select() {
  for (const button of $("pockets").children) button.setAttribute("aria-pressed", String(Number(button.dataset.value) === guess));
  for (const button of $("bets").children) button.setAttribute("aria-pressed", String(Number(button.dataset.value) === bet));
  $("pick-label").textContent = `Pocket ${guess}`; $("bet-label").textContent = bet; $("bet-plural").textContent = bet === 1 ? "" : "s";
  $("return-exact").textContent = money(bet * 2); $("return-near").textContent = money(Math.ceil(bet * 1.5)); $("return-close").textContent = money(bet);
  controls(); drawField();
} // Preview the exact whole-coin returns before committing a bet.

function showResult(round) {
  displayed = round;
  terrainRound = round; usedPegs = new Set((round.trajectory || []).filter(point => ["coin", "bomb"].includes(point.hit)).map(point => `${point.row}:${point.column}`));
  $("peg-bonus").textContent = round.bonus || 0;
  const distance = Math.abs(round.guess - round.landing), labels = ["Right on the rainbow!", "So close. Still sparkling!", "A soft landing. Stake returned."];
  $("result-title").textContent = labels[distance] || "A little further this time.";
  $("result-copy").textContent = `You picked ${round.guess}. The ball landed in ${round.landing} from pin ${round.path[0]}. Bet: ${money(round.bet)}. Landing return: ${money(round.basePayout ?? round.payout)}. Coin pegs: +${money(round.bonus || 0)}.`;
  $("result-value").textContent = round.state === "credit" ? `${money(round.payout)} pending` : `${money(round.payout)} returned`;
  $("field-status").textContent = `Landed in pocket ${round.landing} · ${round.state === "credit" ? "payout pending" : `${money(round.payout)} returned`}`;
  $("field").setAttribute("aria-label", `Completed drop: entry pin ${round.path[0]}, landing pocket ${round.landing}, guess ${round.guess}, ${money(round.payout)} ${round.state === "credit" ? "pending" : "returned"}, including ${money(round.bonus || 0)} from coin pegs.`);
  controls(); drawField();
} // Show the saved result and distinguish a promised payout from a confirmed wallet credit.

function render() {
  if (unconfirmed && data?.playerId && unconfirmed.owner !== data.playerId) saveRequest(null); // A shared browser must never retry another account's unsent wager.
  $("balance").textContent = Number.isSafeInteger(data?.coins) ? data.coins.toLocaleString() : "—";
  $("greeting").textContent = data ? `Hello, ${data.username}` : "Ready for a little luck?";
  $("logout").hidden = !data; $("signin").hidden = Boolean(data);
  if (unconfirmed && data?.receipt?.request === unconfirmed.request && ["done", "failed"].includes(data.receipt.state)) saveRequest(null);
  $("recent").replaceChildren();
  for (const round of data?.recent || []) {
    const button = document.createElement("button"), number = document.createElement("strong"), text = document.createElement("small");
    button.style.setProperty("--color", colors[round.landing - 1]); number.textContent = round.landing; text.textContent = `${round.payout} returned`;
    button.setAttribute("aria-label", `Replay landing ${round.landing}, ${money(round.payout)} returned. Free replay.`);
    button.append(number, text); button.addEventListener("click", () => { if (!busy && !animating) void animate(round); }); $("recent").append(button);
  }
  if (!$("recent").children.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "Your settled drops will appear here."; $("recent").append(empty); }
  if (!data) { displayed = null; ball = null; terrainRound = null; usedPegs.clear(); $("peg-bonus").textContent = "0"; $("result-title").textContent = "A pocketful of possibility."; $("result-copy").textContent = "Sign in to play with your LiDollcoins."; $("result-value").textContent = ""; }
  if (data?.round && !animating) showResult(data.round);
  controls(); drawField();
} // Refresh only this player's server snapshot; never use browser values to compute a wallet payout.

async function refresh() { data = await api("state"); render(); } // Reconcile saved state before enabling a new bet.
function requestId() { return crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, "0")).join(""); }
async function act(retry = false) {
  if (busy || animating || !data) return;
  busy = true; notice(); controls();
  const previousId = data.round?.id;
  let submitted = false;
  try {
    const input = retry ? data.pending ? { action: "retry" } : unconfirmed : { action: "drop", request: requestId(), bet, guess };
    if (!input) throw new Error("Refresh to check the saved payment.");
    if (input.action === "drop") saveRequest({ ...input, owner: data.playerId });
    submitted = true;
    const result = await api("action", input);
    saveRequest(null); data = { ...data, ...result.snapshot };
    if (result.round) await animate(result.round);
    render();
    try { await refresh(); } catch { notice("Your drop completed. Refresh to update your balance."); data.coins = null; }
  } catch (error) {
    notice(submitted ? error.message : "The browser could not prepare the bet. Nothing was sent. Refresh and try again.");
    if (submitted) {
      try { await refresh(); if (data.round && data.round.id !== previousId) await animate(data.round); }
      catch { if (data) data.coins = null; }
    }
  } finally { busy = false; controls(); }
} // Reuse uncertain wager IDs, display paid outcomes before balance refresh, and keep controls recoverable after preparation failures.

const canvas = $("field"), ctx = canvas.getContext("2d"), x = column => 45 + (column - 1) * 61.1, y = row => 65 + row * 38;
let ball = null, particles = [], impacts = [], raf = null, terrainRound = null, usedPegs = new Set();
function dot(px, py, radius, color, glow = 0) {
  ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = glow; ctx.fill(); ctx.shadowBlur = 0;
} // Draw crisp colored lights with a bounded glow rather than external image assets.

function drawPeg(column, row, type) {
  const px = x(column), py = y(row), used = usedPegs.has(`${row}:${column}`);
  if (type === "block") {
    ctx.fillStyle = "#786b94"; ctx.strokeStyle = "#ded0ff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(px - 13, py - 8, 26, 16, 4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 7, py + 4); ctx.lineTo(px - 1, py - 4); ctx.moveTo(px + 1, py + 4); ctx.lineTo(px + 7, py - 4); ctx.stroke();
  } else if (type === "bomb") {
    dot(px, py, used ? 6 : 10, used ? "#70505166" : "#fb836f", used ? 0 : 13);
    if (!used) {
      dot(px, py, 7, "#251329"); ctx.strokeStyle = "#ffcb8d"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px + 4, py - 7); ctx.quadraticCurveTo(px + 4, py - 18, px + 11, py - 12); ctx.stroke(); dot(px + 11, py - 12, 2.2, "#fff0a0", 9);
    }
  } else if (type === "coin") {
    dot(px, py, used ? 5 : 10, used ? "#b4944255" : "#ffc851", used ? 0 : 14);
    if (!used) { ctx.strokeStyle = "#fff1b1"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#5f390f"; ctx.font = "bold 13px system-ui"; ctx.textAlign = "center"; ctx.fillText("+", px, py + 4); }
  } else { dot(px, py, 4.2, `${colors[column - 1]}b0`, 7); dot(px - 1, py - 1, 1.3, "#ffffffae"); }
} // Draw distinct blocked, explosive and collectible pegs; consumed coins/bombs dim for the remainder of the saved drop.

function drawField() {
  const obstacles = new Map((terrainRound?.obstacles || data?.obstacles || []).map(peg => [`${peg.row}:${peg.column}`, peg.type]));
  ctx.clearRect(0, 0, 640, 920);
  const gradient = ctx.createLinearGradient(0, 0, 640, 850); gradient.addColorStop(0, "#241139"); gradient.addColorStop(.5, "#121426"); gradient.addColorStop(1, "#19122e"); ctx.fillStyle = gradient; ctx.fillRect(15, 8, 610, 880);
  for (let n = 0; n < 52; n++) dot(25 + ((n * 173) % 580), 28 + ((n * 113) % 775), n % 4 ? .6 : 1.1, "#bca7ff44");
  for (let col = 1; col <= 10; col++) {
    const chosen = col === guess;
    ctx.fillStyle = chosen ? `${colors[col - 1]}0b` : "#ffffff02"; ctx.fillRect(x(col) - 25, 43, 50, 793);
    ctx.font = "600 13px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = col >= 4 && col <= 7 ? "#f2b5ff" : "#756384"; ctx.fillText(String(col), x(col), 27);
    if (col >= 4 && col <= 7) { ctx.fillStyle = "#d791ff"; ctx.beginPath(); ctx.moveTo(x(col) - 4, 35); ctx.lineTo(x(col) + 4, 35); ctx.lineTo(x(col), 41); ctx.fill(); }
    for (let row = 0; row < 20; row++) drawPeg(col, row, obstacles.get(`${row}:${col}`));
    const landed = !animating && displayed?.landing === col;
    ctx.fillStyle = landed ? colors[col - 1] : `${colors[col - 1]}21`; ctx.strokeStyle = colors[col - 1]; ctx.lineWidth = chosen || landed ? 2.5 : 1;
    ctx.beginPath(); ctx.roundRect(x(col) - 25, 841, 50, 49, 10); ctx.fill(); ctx.stroke(); ctx.fillStyle = landed ? "#181029" : colors[col - 1]; ctx.font = "800 20px system-ui"; ctx.fillText(String(col), x(col), 872);
    if (chosen) { ctx.fillStyle = colors[col - 1]; ctx.font = "700 8px system-ui"; ctx.fillText("YOUR PICK", x(col), 908); }
  }
  for (const impact of impacts) {
    ctx.beginPath(); ctx.arc(impact.x, impact.y, (1 - impact.life) * (impact.type === "bomb" ? 60 : 26) + 5, 0, Math.PI * 2); ctx.strokeStyle = impact.color; ctx.globalAlpha = impact.life; ctx.lineWidth = impact.type === "bomb" ? 3 : 2; ctx.stroke();
    if (impact.coins) { ctx.fillStyle = "#ffe28c"; ctx.font = "800 22px system-ui"; ctx.textAlign = "center"; ctx.fillText(`+${impact.coins}`, impact.x, impact.y - 22 - (1 - impact.life) * 35); }
  } ctx.globalAlpha = 1;
  for (const particle of particles) { ctx.globalAlpha = Math.max(0, particle.life); dot(particle.x, particle.y, particle.size * Math.max(.1, particle.life), particle.color, 7); } ctx.globalAlpha = 1;
  if (ball) { dot(ball.x, ball.y, 16, "#d892ff22", 24); dot(ball.x, ball.y, 7, "#fff8ff", 18); dot(ball.x - 2, ball.y - 2, 2.5, "#ffffff"); }
} // Render exactly 200 pins and ten pockets; highlights and animation cannot affect the saved result.

async function animate(round) {
  if (animating) return;
  if (!motion.matches) canvas.scrollIntoView({ block: "center", behavior: "smooth" }); // Keep the drop visible when mobile betting controls sit below the tall field.
  animating = true; displayed = null; terrainRound = round; usedPegs.clear(); particles = []; impacts = []; $("peg-bonus").textContent = "0"; controls();
  $("result-title").textContent = "A little rainbow in motion…"; $("result-copy").textContent = `Entered at pin ${round.path[0]}. Your guess: pocket ${round.guess}.`; $("result-value").textContent = "";
  $("field-status").textContent = `Dropping from pin ${round.path[0]}…`;
  if (!motion.matches) await new Promise(resolve => {
    const trajectory = round.trajectory?.length ? round.trajectory : round.path.map((column, row) => ({ column, row }));
    const points = [{ x: x(round.path[0]), y: 34 }, ...trajectory.map(point => ({ ...point, x: x(point.column), y: point.row === 20 ? 858 : y(point.row) - 8 }))];
    const ends = [0]; for (const point of points.slice(0, -1)) ends.push(ends.at(-1) + (point.hit === "bomb" ? 360 : 195));
    const started = performance.now(); let last = started, previousSegment = -1, collected = 0;
    const frame = time => {
      const elapsed = time - started; let segment = 0; while (segment < points.length - 2 && elapsed >= ends[segment + 1]) segment++;
      const fraction = Math.min(1, (elapsed - ends[segment]) / (ends[segment + 1] - ends[segment])), step = Math.min(2, (time - last) / 16.67); last = time;
      const from = points[segment], to = points[segment + 1];
      ball = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction - Math.sin(fraction * Math.PI) * (from.hit === "bomb" ? 30 : 10) };
      if (segment !== previousSegment) {
        for (let skipped = previousSegment + 1; skipped <= segment; skipped++) {
          const hit = points[skipped];
          if (["bomb", "coin"].includes(hit.hit)) usedPegs.add(`${hit.row}:${hit.column}`);
          if (hit.coins) { collected += hit.coins; $("peg-bonus").textContent = collected; }
        } // Account for every saved pickup even if a backgrounded tab skips animation frames.
        previousSegment = segment;
        const color = from.hit === "coin" ? "#ffe28c" : from.hit === "bomb" ? "#ff9f82" : from.hit === "block" ? "#ddc8ff" : colors[Math.max(0, round.path[Math.max(0, segment - 1)] - 1)];
        impacts.push({ ...from, life: 1, color, type: from.hit, coins: from.coins });
        if (from.hit) {
          $("field-status").textContent = from.hit === "bomb" ? "Boom! A new direction…" : from.hit === "coin" ? `Coin peg! +${from.coins} extra coins.` : "Blocked peg! Bouncing sideways…";
          for (let n = 0; n < (from.hit === "bomb" ? 36 : 16); n++) { const angle = n * Math.PI * 2 / (from.hit === "bomb" ? 36 : 16), speed = from.hit === "bomb" ? 4 : 2; particles.push({ ...from, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 2.5, life: 1, color }); }
        }
      }
      if (!motion.matches) for (let n = 0; n < 3; n++) particles.push({ ...ball, vx: (Math.random() - .5) * 2, vy: -Math.random() * 1.8, size: 1.5 + Math.random() * 3, life: 1, color: colors[(segment + n) % 10] });
      for (const p of particles) { p.x += p.vx * step; p.y += p.vy * step; p.life -= .025 * step; } particles = particles.filter(p => p.life > 0).slice(-220);
      for (const hit of impacts) hit.life -= (hit.type ? .022 : .05) * step; impacts = impacts.filter(hit => hit.life > 0);
      drawField();
      if (elapsed >= ends.at(-1) || motion.matches) { raf = null; resolve(); } else raf = requestAnimationFrame(frame);
    }; raf = requestAnimationFrame(frame);
  });
  ball = { x: x(round.landing), y: 852 }; animating = false; particles = []; impacts = []; showResult(round);
} // Replay the authoritative path with colorful trails and pin rings; reduced motion reveals the result immediately.

for (let value = 1; value <= 10; value++) {
  const button = document.createElement("button"); button.type = "button"; button.dataset.value = value; button.textContent = value; button.style.setProperty("--color", colors[value - 1]); button.setAttribute("aria-label", `Guess pocket ${value}`);
  button.addEventListener("click", () => { guess = value; select(); }); $("pockets").append(button);
}
for (const value of [1, 5, 10, 25, 50, 100]) {
  const button = document.createElement("button"); button.type = "button"; button.dataset.value = value; button.textContent = value; button.setAttribute("aria-label", `Bet ${money(value)}`);
  button.addEventListener("click", () => { bet = value; select(); }); $("bets").append(button);
} // Native buttons support touch, keyboard focus and screen-reader selection announcements.
$("drop").addEventListener("click", () => { void act(); }); $("retry").addEventListener("click", () => { void act(true); });
$("replay").addEventListener("click", () => { if (displayed && !busy && !animating) void animate(displayed); });
$("refresh").addEventListener("click", async () => { if (busy || animating) return; busy = true; controls(); try { await refresh(); notice(data.walletError || ""); } catch (error) { if (data) data.coins = null; notice(error.message); } finally { busy = false; controls(); } });
$("logout").addEventListener("click", async () => { if (busy || animating) return; busy = true; controls(); try { await api("logout", {}); saveRequest(null); location.reload(); } catch (error) { notice(error.message); } finally { busy = false; controls(); } });
select(); refresh().then(() => { if (data.walletError) notice(data.walletError); }).catch(error => notice(error.message));
