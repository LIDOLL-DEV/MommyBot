"use strict";
const $ = id => document.getElementById(id);
let state = null, activeTab = "roll", busy = false;
const wipeRequestKey = () => `atelier-wipe-request:${state.csrf}`;
const number = value => new Intl.NumberFormat().format(value);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}; // Render account and catalog text as text nodes, never executable HTML.
function notice(message = "", show = false) {
  $("notice").hidden = !message; $("notice").textContent = message;
  if (message && show) $("notice").scrollIntoView({ block: "nearest" });
} // Bring failures into view on phones instead of leaving them above the roll button off-screen.
function art(item) {
  const frame = element("div", `art${item.sprite ? " sprite" : ""}`), image = element("img");
  image.src = `/diapers/art/${encodeURIComponent(item.image)}`;
  image.alt = item.name; image.loading = "lazy"; image.width = 280; image.height = 210;
  frame.append(image); return frame;
} // Display supplied artwork directly; sprite framing enlarges legacy thumbnails without rewriting source PNGs.
async function api(route, payload) {
  const response = await fetch(`/diapers/api/${route}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(22000),
    ...(payload ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": state?.csrf || "" }, body: JSON.stringify(payload) } : {}) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) signedOut();
    throw Object.assign(new Error(data.error || "The atelier could not finish that request. Refresh and retry any pending payment."), {retryable:data.retryable});
  }
  return data;
} // The only browser credential is an HttpOnly session cookie; wallet tokens and account IDs never enter client storage.
function signedOut() {
  state = null; $("game").hidden = true; $("signed-out").hidden = false; $("logout").hidden = true;
  $("balance").textContent = "—"; $("greeting").textContent = "A little home for your favorite finds.";
}
async function refresh() {
  state = await api("state");
  $("signed-out").hidden = true; $("game").hidden = false; $("logout").hidden = false;
  render();
  if (state.walletError) notice(state.walletError);
}
function controls() {
  $("refresh").disabled = busy; $("logout").disabled = busy; $("retry").disabled = busy;
  if (!state) return;
  $("buy-wipe").disabled = busy || !state.supplies?.enabled || !!state.supplies?.pending || !!sessionStorage.getItem(wipeRequestKey()) || state.coins === null || state.coins < state.supplies?.price;
  $("retry-wipe").disabled = busy;
  const reason = busy ? "Your request is finishing. Please wait…"
    : !state.enabled ? "New rolls are paused by Doll. You can still browse your collection."
    : state.pending ? "Finish your saved payment with Retry payment above before rolling again."
    : state.coins === null ? (state.walletError || "Your LiDollcoin balance is unavailable. Press Refresh, or sign in with LiD0llID again.")
    : state.coins < state.rollPrice ? `You need ${state.rollPrice} LiDollcoins to roll. Your connected wallet has ${number(state.coins)}. Earn coins or sell a diaper, then press Refresh. Stars cannot pay for diaper rolls.`
    : "";
  $("roll").disabled = Boolean(reason);
  $("roll").setAttribute("aria-busy", String(busy));
  $("roll").title = reason;
  $("roll-status").textContent = reason;
  $("roll-status").hidden = !reason;
  document.querySelectorAll("[data-purchase]").forEach(button => {
    button.disabled = busy || !state.enabled || Boolean(state.pending) || (button.dataset.purchase === "buy" && (state.coins === null || state.coins < Number(button.dataset.amount)));
  });
} // Disable repeats while a request runs; server-side locks and idempotency remain authoritative across tabs and restarts.
function render() {
  $("supplies").hidden = !state.supplies;
  if (state.supplies) {
    $("wipe-art").src = "/diapers/art/pocketwipes1.png";
    $("wipe-count").textContent = `${state.supplies.wipes} baby wipes in your care supplies.`;
    $("buy-wipe").textContent = `Buy 1 baby wipe · ${state.supplies.price} coin${state.supplies.price === 1 ? "" : "s"}`;
    $("retry-wipe").hidden = !state.supplies.pending && !sessionStorage.getItem(wipeRequestKey());
  }
  $("balance").textContent = state.coins === null ? "—" : number(state.coins);
  $("greeting").textContent = `Welcome back, ${state.username}. Your drawer is right here. ♡`;
  $("total").textContent = number(state.owned.reduce((sum, row) => sum + row.quantity, 0));
  $("unique").textContent = `${state.owned.length} / ${state.catalog.length}`;
  $("bank-total").textContent = number(state.bank.reduce((sum, row) => sum + row.quantity, 0));
  $("roll-price").textContent = number(state.rollPrice);
  $("pending").hidden = !state.pending;
  if (state.pending) $("pending-copy").textContent = `Your ${state.pending.action} for ${state.pending.amount} LiDollcoins is saved. Retry it to finish the same transaction.`;
  const odds = Object.entries(state.tiers).map(([key, tier]) => {
    const box = element("div"); box.append(element("span", `rarity ${key}`, tier.label), element("strong", "", `${tier.chance}%`)); return box;
  });
  $("odds").replaceChildren(...odds);
  $("history").replaceChildren(...state.history.map(job => {
    const item = state.catalog.find(entry => entry.id === job.design);
    return element("div", "history-item", `${job.action === "sell" ? "Sold" : job.action === "buy" ? "Bought" : "Unwrapped"} ${item?.name || "a diaper"} · ${job.amount} coins`);
  }));
  if (!state.history.length) $("history").append(element("p", "muted fine", "Your first little discovery will appear here."));
  if (!state.enabled) notice("New rolls and bank trades are paused. You can still browse your collection and recover pending payments.");
  tab(activeTab);
}
function tab(name) {
  activeTab = name;
  document.querySelectorAll("[data-tab]").forEach(button => {
    if (button.dataset.tab === name) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  $("roll-panel").hidden = name !== "roll"; $("gallery-panel").hidden = name === "roll";
  if (name !== "roll") gallery();
  controls();
}
function gallery() {
  const labels = {
    collection: ["YOUR LITTLE TREASURES", "My collection", "Sell a copy to earn LiDollcoins. Your other copies stay in your drawer."],
    bank: ["PRELOVED, READY FOR YOU", "The diaper bank", "A shared bank for everyone. Fewer copies of a design mean higher prices; more copies make it cheaper. Refresh for current quotes."],
    catalog: ["EVERY LITTLE POSSIBILITY", "The design book", "All designs, their exact roll odds, and the details that inspired their rarity."],
  };
  const [eyebrow, title, copy] = labels[activeTab];
  $("gallery-eyebrow").textContent = eyebrow; $("gallery-title").textContent = title; $("gallery-copy").textContent = copy;
  $("duplicates-label").hidden = activeTab !== "collection";
  const search = $("search").value.trim().toLowerCase(), rarity = $("rarity").value;
  const cards = [];
  for (const item of state.catalog) {
    const own = state.owned.find(row => row.design === item.id), stock = state.bank.find(row => row.design === item.id);
    if (activeTab === "collection" && (!own || ($("duplicates").checked && own.quantity < 2))) continue;
    if (activeTab === "bank" && !stock) continue;
    if (rarity && item.rarity !== rarity) continue;
    if (search && !`${item.name} ${item.description}`.toLowerCase().includes(search)) continue;
    const card = element("article", "diaper-card"), top = element("div", "card-top");
    top.append(element("span", `rarity ${item.rarity}`, state.tiers[item.rarity].label));
    top.append(element("span", "quantity", activeTab === "bank" ? `${stock.quantity} at bank` : own ? `Owned ×${own.quantity}` : "Not collected"));
    card.append(top, art(item), element("h3", "", item.name), element("p", "card-description", item.description));
    if (activeTab === "catalog") {
      card.append(element("p", "design-odds", `${item.chance.toFixed(3)}% per roll`), element("p", "fine", `${item.stock} at bank · sell ${item.sell} · buy ${item.buy} coins`));
    } else {
      const action = activeTab === "bank" ? "buy" : "sell", amount = item[action];
      card.append(element("p", "fine", `${item.stock} ${item.stock === 1 ? "copy" : "copies"} in bank · price follows stock`));
      const button = element("button", action === "buy" ? "primary" : "quiet", `${action === "buy" ? "Buy" : "Sell"} 1 · ${amount} coins`);
      button.type = "button";
      if (action === "sell" && !own.available) { button.disabled = true; button.textContent = "Payment pending"; }
      else { button.dataset.purchase = action; button.dataset.amount = amount; button.addEventListener("click", () => transact(action, item.id, amount)); }
      card.append(button);
    }
    cards.push(card);
  }
  if (!cards.length) {
    const empty = element("div", "empty");
    empty.append(element("span", "sigil", "✧"), element("h3", "", "A little room for something lovely"), element("p", "", activeTab === "bank" ? "No matching stock just yet. Diapers appear here when someone sells them to the bank." : "No matching diapers. Try another filter, or visit the capsule machine for a new find."));
    cards.push(empty);
  }
  $("gallery").replaceChildren(...cards);
  controls();
}
function reveal(result) {
  $("reveal-art").replaceChildren(art(result.item));
  $("reveal-rarity").className = `rarity ${result.item.rarity}`;
  $("reveal-rarity").textContent = state.tiers[result.item.rarity].label;
  $("reveal-title").textContent = result.item.name;
  $("reveal-description").textContent = result.item.description;
  $("reveal-message").textContent = `Added to your collection for ${result.amount} LiDollcoins.`;
  $("reveal").showModal();
} // A reveal is shown only for a confirmed, delivered purchase, never a preview of an unpaid random draw.
async function transact(action, design, amount) {
  if (busy || !state) return;
  busy = true; controls(); notice();
  let submitted = false;
  try {
    const request = typeof crypto.randomUUID === "function" ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
    submitted = true; // Request preparation belongs inside try/finally so a browser failure cannot leave busy stuck forever.
    const result = await api("action", { action, design, amount, request });
    if (result.action === "sell") notice(`Sold ${result.item.name} to the bank for ${result.amount} LiDollcoins. Thank you for giving it a new home!`);
    else reveal(result);
    try { await refresh(); }
    catch { notice("Your diaper transaction completed, but the updated balance could not be loaded. Press Refresh to update your collection and wallet."); }
  } catch (error) {
    const message = !submitted ? "This browser could not start the transaction. No payment was sent. Refresh or try an up-to-date browser."
      : error.name === "TimeoutError" || error.name === "AbortError" ? "The request timed out. Checking for a saved payment; use Retry payment if one appears."
      : error.message || "The request was interrupted. Refresh and retry any pending payment.";
    notice(message, true);
    try { await refresh(); } catch { /* Keep the original failure visible while the service recovers. */ }
    notice(message);
  } finally { busy = false; controls(); }
} // Show confirmed prizes before refreshing the wallet; reconcile interrupted requests without issuing a replacement payment.
document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => tab(button.dataset.tab)));
for (const id of ["search", "rarity", "duplicates"]) $(id).addEventListener("input", () => { if (state && activeTab !== "roll") gallery(); });
$("roll").addEventListener("click", () => transact("roll", undefined, state.rollPrice));
async function buyWipe(retry = false) {
  if (busy || !state?.supplies) return;
  busy = true; controls(); notice();
  try {
    const key = wipeRequestKey();
    let request = sessionStorage.getItem(key);
    if (!retry && request) throw new Error("Retry the saved wipe purchase first.");
    if (!request) { request = JSON.stringify({action:"buy",request:crypto.randomUUID(),amount:state.supplies.price}); sessionStorage.setItem(key,request); }
    const input = retry && state.supplies.pending ? {action:"retry"} : JSON.parse(request);
    await api("supplies",input); sessionStorage.removeItem(key);
    await refresh(); notice("One baby wipe added to your care supplies.");
  } catch (error) {
    if (error.retryable === false && state) sessionStorage.removeItem(wipeRequestKey());
    try { await refresh(); } catch { /* Keep the exact purchase for recovery when the network returns. */ }
    notice(error.message,true);
  } finally { busy = false; controls(); }
} // Reuse the exact request after a lost response, including across reloads; never charge for a replacement purchase.
$("buy-wipe").addEventListener("click", () => buyWipe());
$("retry-wipe").addEventListener("click", () => buyWipe(true));
$("retry").addEventListener("click", () => transact("retry"));
$("refresh").addEventListener("click", async () => { if (busy) return; busy = true; controls(); notice(); try { await refresh(); } catch (error) { notice(error.message); } finally { busy = false; controls(); } });
$("logout").addEventListener("click", async () => { if (busy) return; busy = true; controls(); try { await api("logout", {}); signedOut(); notice("Signed out of the atelier. Your diapers stay in your collection."); } catch (error) { notice(error.message); } finally { busy = false; controls(); } });
for (const id of ["close-reveal", "reveal-done"]) $(id).addEventListener("click", () => $("reveal").close());
refresh().catch(error => { signedOut(); notice(error.message); });
