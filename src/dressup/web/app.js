import { drawDoll, thumbnail } from "./doll.js";

const $ = id => document.getElementById(id), shopPage = location.pathname.startsWith("/clothes");
let state, view = "owned", busy = false, galleryPage = 0;
const pageSize = 36;
const labels = { diaper: "Diaper", head: "Headwear", top: "Tops & dresses", bottom: "Bottoms", shoes: "Shoes", socks: "Socks",
  underwear: "Underwear", bra: "Bras", corset: "Corsets", belt: "Belts & suspenders", gloves: "Gloves", accessory: "Accessories", bag: "Bags", hand: "Handhelds" };
const requestKey = () => `clothes-pending-request:${state.csrf}`; // A different signed-in account must never replay another browser session's request.
const notice = message => { $("notice").textContent = message; $("notice").hidden = !message; };
const node = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };

async function api(path, input) {
  const response = await fetch(path, { credentials: "same-origin", ...(input ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": state.csrf }, body: JSON.stringify(input) } : {}) });
  const data = await response.json();
  if (response.status === 401) { $("signin").hidden = false; $("game").hidden = true; $("logout").hidden = true; }
  if (!response.ok) throw Object.assign(new Error(data.error || "The game could not complete that action."), { retryable: data.retryable });
  return data;
} // Only authenticated, same-origin requests can change the shared wardrobe.

async function refresh() {
  state = await api("/clothes/api/state");
  $("signin").hidden = true; $("game").hidden = false; $("logout").hidden = false;
  $("balance").textContent = state.coins === null ? "Wallet offline" : `${state.coins.toLocaleString()} coins`;
  $("pending").hidden = !state.shop.pending && !sessionStorage.getItem(requestKey());
  $("roll").textContent = `Roll for ${state.shop.rollPrice} coins`;
  $("roll-status").textContent = state.walletError || (!state.shop.enabled ? "New purchases are paused." : state.shop.pending ? "Finish your saved payment first." : state.coins < state.shop.rollPrice ? "You need more coins to roll." : "Each design within a rarity has the same chance.");
  $("odds").replaceChildren(...Object.values(state.shop.tiers).map(tier => node("span", `${tier.label} ${tier.chance}%`)));
  $("name").value = state.doll.player.name; $("shape").value = state.doll.player.shape;
  for (const key of ["hair", "face"]) {
    $(key).replaceChildren(...state.catalog[key === "hair" ? "hair" : "faces"].map(name => {
      const option = node("option", name.replace(/^TQ_(Hair|Face)_/, "").replace(/\.png$/, "").replaceAll("_", " ")); option.value = name; return option;
    }));
    $(key).value = state.doll.player[key];
  }
  renderDoll(); renderGallery(); updateButtons();
} // Refresh the wallet, ownership, care and appearance together so every view uses the same snapshot.

function renderDoll() {
  const doll = state.doll;
  $("doll-name").textContent = doll.player.name;
  $("stance").textContent = doll.stance === "wide" ? "Wide stance · room for a larger diaper" : "Regular stance · a comfortable fit";
  $("bond").textContent = `${doll.player.careCount} care moment${doll.player.careCount === 1 ? "" : "s"}`;
  $("needs").replaceChildren(...Object.entries({ hunger: "Fullness", energy: "Energy", comfort: "Comfort", joy: "Happiness" }).map(([key, title]) => {
    const el = node("div", null, "need"), label = node("label", title), progress = node("progress");
    progress.id = `need-${key}`; label.htmlFor = progress.id; label.append(node("span", Math.round(doll.player[key]).toString()));
    progress.max = 100; progress.value = doll.player[key]; el.append(label, progress); return el;
  }));
  $("outfit-note").textContent = doll.removed.length ? "Unavailable or incompatible pieces returned to your wardrobe. Starter pieces fill any gaps." : "Outfit saved. Larger diapers choose their matching base automatically.";
  drawDoll($("doll"), doll).catch(error => notice(error.message));
} // Let the server choose the matching base and effective owned outfit.

function updateButtons() {
  document.querySelectorAll("button").forEach(button => { button.disabled = busy || button.dataset.unavailable === "true"; });
  if (state) {
    $("roll").disabled = busy || !state.shop.enabled || !!state.shop.pending || state.coins === null || state.coins < state.shop.rollPrice;
    document.querySelectorAll("[data-care]").forEach(button => { button.disabled = busy || (state.doll.player.cooldowns[button.dataset.care] || 0) > state.doll.now; });
  }
} // Keep duplicate clicks out of the UI; the payment journal also enforces idempotency on the server.

async function run(work) {
  if (busy) return;
  busy = true; notice(""); updateButtons();
  try { await work(); } catch (error) { notice(error.message); }
  finally { busy = false; updateButtons(); }
}

async function dollAction(input) {
  state.doll = await api("/littlepottchi/api/doll", input); renderDoll(); renderGallery();
} // Dressing and care are free and never invoke a wallet operation.

async function purchase(action, item = null) {
  const key = requestKey();
  let input;
  if (action === "retry") {
    const saved = sessionStorage.getItem(key);
    if (state.shop.pending) input = { action: "retry" };
    else if (saved) input = JSON.parse(saved);
    else return;
  } else {
    if (sessionStorage.getItem(key)) { notice("Finish the saved purchase with Retry payment before starting another."); $("pending").hidden = false; return; }
    input = { action, design: item?.id || null, request: crypto.randomUUID(), amount: action === "roll" ? state.shop.rollPrice : item[action] };
    sessionStorage.setItem(key, JSON.stringify(input));
  }
  try {
    const result = await api("/clothes/api/action", input);
    sessionStorage.removeItem(key);
    await refresh();
    $("prize-name").textContent = result.item.name; $("prize-rarity").textContent = result.item.rarity;
    $("prize-copy").textContent = result.action === "sell" ? `Sold one copy for ${result.amount} coins.` : `One copy added to your wardrobe for ${result.amount} coins.`;
    $("prize-art").getContext("2d").clearRect(0, 0, 160, 150);
    await thumbnail($("prize-art"), result.item); $("reveal").showModal();
  } catch (error) {
    if (error.retryable === false) sessionStorage.removeItem(key);
    // Retain the exact request after network uncertainty; a reload must never replace a paid roll.
    try {
      await refresh();
    } catch { /* Preserve the request if even the recovery snapshot is unavailable. */ }
    $("pending").hidden = !state.shop.pending && !sessionStorage.getItem(key);
    throw error;
  }
} // Journal-backed retries keep the original prize and price when a response is lost.

function renderGallery() {
  const diapersView = view === "diapers", rows = diapersView ? state.doll.ownedDiapers : state.shop.owned;
  const owned = new Map(rows.map(row => [row.design, row]));
  const all = diapersView ? state.diapers.map(item => ({ ...item, ...state.catalog.diapers.find(d => d.id === item.id), slot: "diaper" })) : state.shop.catalog;
  const term = $("search").value.trim().toLowerCase(), slot = $("slot").value, rarity = $("rarity").value;
  const filtered = all.filter(item => (view === "catalog" || view === "bank" ? view !== "bank" || item.stock > 0 : (owned.get(item.id)?.quantity || 0) > 0) &&
    (!term || `${item.name} ${item.description}`.toLowerCase().includes(term)) && (diapersView || !slot || item.slot === slot) && (!rarity || item.rarity === rarity));
  $("gallery-title").textContent = { owned: "Your wardrobe", diapers: "Your Atelier diapers", catalog: "The design book", bank: "The clothing bank" }[view];
  $("collection-count").textContent = `${rows.reduce((sum, row) => sum + row.quantity, 0)} pieces`;
  $("slot").disabled = diapersView;
  $("equipped").replaceChildren(...Object.entries(state.doll.outfit).map(([slot, item]) => {
    const button = node("button", `${labels[slot]} · ${item.name || state.diapers.find(d => d.id === item.id)?.name || item.id} ×`);
    button.addEventListener("click", () => run(() => dollAction({ action: "equip", slot, design: null }))); return button;
  }));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  galleryPage = Math.min(galleryPage, pages - 1);
  $("gallery-status").textContent = filtered.length ? `${galleryPage * pageSize + 1}–${Math.min((galleryPage + 1) * pageSize, filtered.length)} of ${filtered.length} pieces` : "0 pieces";
  $("previous-page").dataset.unavailable = String(galleryPage === 0);
  $("next-page").dataset.unavailable = String(galleryPage >= pages - 1);
  $("gallery").replaceChildren(...filtered.slice(galleryPage * pageSize, (galleryPage + 1) * pageSize).map(item => {
    const card = node("article", null, "item"), art = node("canvas"); art.width = 160; art.height = 150; art.setAttribute("aria-label", item.name); art.setAttribute("role", "img");
    card.append(art, node("span", item.rarity, "pill"), node("h3", item.name));
    const count = owned.get(item.id), fit = diapersView || item.stances.includes(state.doll.stance);
    card.append(node("p", diapersView ? `${item.stance === "wide" ? "Wide" : "Regular"} stance · ${count?.quantity || 0} owned` : `${labels[item.slot]} · ${count?.quantity || 0} owned`));
    if (item.fitNote) card.append(node("p", item.fitNote));
    if (view === "catalog") card.append(node("p", `${item.chance.toFixed(3)}% per roll`));
    if (count?.available > 0) {
      const wear = node("button", fit ? "Wear this" : `Needs ${item.stances.join(" or ")} stance`); wear.dataset.unavailable = String(!fit);
      wear.addEventListener("click", () => run(() => dollAction({ action: "equip", slot: item.slot, design: item.id }))); card.append(wear);
      if (!diapersView) {
        const sell = node("button", `Sell 1 · ${item.sell} coins`); sell.dataset.unavailable = String(!state.shop.enabled || !!state.shop.pending);
        sell.addEventListener("click", () => run(() => purchase("sell", item))); card.append(sell);
      }
    }
    if (view === "bank") {
      const buy = node("button", `Buy 1 · ${item.buy} coins (${item.stock} in bank)`);
      buy.dataset.unavailable = String(!state.shop.enabled || !!state.shop.pending || state.coins === null || state.coins < item.buy);
      buy.addEventListener("click", () => run(() => purchase("buy", item))); card.append(buy);
    }
    thumbnail(art, item).catch(error => notice(error.message)); return card;
  }));
  if (!filtered.length) $("gallery").append(node("p", diapersView ? "No matching diapers yet. Visit Diaper Atelier to grow your collection." : "No matching pieces yet. Try a roll, browse the bank, or change your filters.", "empty"));
  updateButtons();
} // Render names as text, enforce slot fit visibly, and keep item illustrations separate from wearable layers.

$("login").href = shopPage ? "/clothes/login" : "/littlepottchi/login";
$("slot").replaceChildren(node("option", "Every piece"), ...Object.entries(labels).filter(([key]) => key !== "diaper").map(([key, label]) => {
  const option = node("option", label); option.value = key; return option;
}));
$("slot").options[0].value = "";
for (const [id, delta] of [["previous-page", -1], ["next-page", 1]]) $(id).addEventListener("click", () => { galleryPage += delta; renderGallery(); });
$(shopPage ? "shop-link" : "pet-link").setAttribute("aria-current", "page");
$("roll-panel").hidden = !shopPage; $("care-panel").hidden = shopPage;
if (shopPage) {
  document.title = "Clothes Emporium · Littlepottchi";
  $("eyebrow").textContent = "A LITTLE LUCK. A LOVELY FIND.";
  $("title").replaceChildren(document.createTextNode("Your next favorite "), node("em", "is in here."));
  $("subtitle").textContent = "Roll for individual pieces. Build your collection. Make every outfit your own.";
  $("other-game").href = "/littlepottchi/"; $("other-game").textContent = "Spend a little time with your doll →";
}
$("refresh").addEventListener("click", () => run(refresh));
$("roll").addEventListener("click", () => run(() => purchase("roll")));
$("retry").addEventListener("click", () => run(() => purchase("retry")));
$("logout").addEventListener("click", () => run(async () => { await api("/clothes/api/logout", {}); location.reload(); }));
document.querySelectorAll("[data-care]").forEach(button => button.addEventListener("click", () => run(() => dollAction({ action: button.dataset.care }))));
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
  view = button.dataset.view; galleryPage = 0; document.querySelectorAll("[data-view]").forEach(other => other.setAttribute("aria-pressed", String(other === button))); renderGallery();
}));
for (const id of ["search", "slot", "rarity"]) $(id).addEventListener("input", () => { galleryPage = 0; if (state) renderGallery(); });
$("appearance").addEventListener("submit", event => { event.preventDefault(); run(() => dollAction({ action: "appearance", name: $("name").value, shape: $("shape").value, hair: $("hair").value, face: $("face").value })); });
for (const id of ["close-reveal", "prize-done"]) $(id).addEventListener("click", () => $("reveal").close());
setInterval(() => { if (state) { state.doll.now += 1000; updateButtons(); } }, 1000); // Update cooldown controls; the server remains authoritative for action timing.
run(refresh);
