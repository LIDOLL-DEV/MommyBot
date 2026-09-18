import { drawDoll, thumbnail } from "./doll.js";
import { createGameMenu } from "./menu.js";

const $ = id => document.getElementById(id), shopPage = location.pathname.startsWith("/clothes");
let state, view = "owned", busy = false, galleryPage = 0;
let petGeneration = 0;
let appearanceDirty = false;
const anatomyKeys = ["chest", "nipples", "genitals", "pubes"];
const pageSize = 36;
const labels = { diaper: "Diaper", head: "Headwear", top: "Tops & dresses", bottom: "Skirts", shoes: "Shoes", socks: "Socks",
  bra: "Bras", corset: "Corsets", belt: "Belts & suspenders", gloves: "Gloves", accessory: "Accessories", bag: "Bags", hand: "Handhelds" };
const requestKey = () => `clothes-pending-request:${state.csrf}`; // A different signed-in account must never replay another browser session's request.
const notice = message => { for (const id of ["notice", "menu-notice"]) { $(id).textContent = message; $(id).hidden = !message; } };
const node = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };

async function api(path, input) {
  const response = await fetch(path, { credentials: "same-origin", ...(input ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": state.csrf }, body: JSON.stringify(input) } : {}) });
  const data = await response.json();
  if (response.status === 401) { menus.close(); $("signin").hidden = false; $("game").hidden = true; $("logout").hidden = true; }
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
  fillAppearance();
  renderDoll(); renderGallery(); updateButtons();
} // Refresh account and care state together; picture menus use the same ownership snapshot.

function fillAppearance() {
  $("name").value = state.doll.player.name; $("shape").value = state.doll.player.shape;
  $("gender").value = state.doll.player.gender;
  for (const key of ["hair", "face"]) {
    $(key).replaceChildren(...state.catalog[key === "hair" ? "hair" : "faces"].map(name => {
      const option = node("option", name.replace(/^TQ_(Hair|Face)_/, "").replace(/\.png$/, "").replaceAll("_", " ")); option.value = name; return option;
    }));
    $(key).value = state.doll.player[key];
  }
  for (const key of anatomyKeys) {
    $(key).replaceChildren(...state.catalog.appearance[key].map(choice => { const option = node("option", choice.name); option.value = choice.id; return option; }));
    $(key).value = state.doll.player.anatomy[key];
  }
  syncHairChoices(); appearanceDirty = false;
} // Opening the creator starts a fresh draft from the saved doll.

function renderDoll() {
  const doll = state.doll;
  $("doll-name").textContent = doll.player.name;
  $("stance").textContent = !doll.diaper ? "Diaper-free · regular stance" : doll.stance === "wide" ? "Wide stance · room for a larger diaper" : "Regular stance · a comfortable fit";
  $("bond").textContent = `${doll.player.careCount} care moment${doll.player.careCount === 1 ? "" : "s"}`;
  $("needs").replaceChildren(...Object.entries({ hunger: "Fullness", hydration: "Hydration", energy: "Energy", comfort: "Comfort", joy: "Happiness" }).map(([key, title]) => {
    const el = node("div", null, "need"), label = node("label", title), progress = node("progress");
    progress.id = `need-${key}`; label.htmlFor = progress.id; label.append(node("span", Math.round(doll.player[key]).toString()));
    progress.max = 100; progress.value = doll.player[key]; el.append(label, progress); return el;
  }));
  $("outfit-note").textContent = doll.removed.length ? "Unavailable pieces returned to the wardrobe." : "Outfit saved";
  renderAppearance();
  renderCare();
} // Let the server choose the matching base and effective owned outfit.

function syncHairChoices() {
  const hair = state.catalog.appearance.hair, selected = hair.find(choice => choice.image === $("hair").value);
  $("hair-style").replaceChildren(...[...new Set(hair.map(choice => choice.style))].map(style => { const option = node("option", `Style ${style}`); option.value = style; return option; }));
  $("hair-style").value = selected.style;
  $("hair-color").replaceChildren(...hair.filter(choice => choice.style === selected.style).map(choice => { const option = node("option", choice.color); option.value = choice.color; return option; }));
  $("hair-color").value = selected.color;
} // Separate hairstyle and color without changing the saved, validated asset ID.

function renderAppearance() {
  if (!state) return;
  let doll = state.doll;
  if (appearanceDirty || $("preview-body").checked) {
    const player = { ...doll.player, shape: $("shape").value, hair: $("hair").value, face: $("face").value };
    const bare = $("preview-body").checked, stance = bare ? "narrow" : doll.stance;
    const groups = ["chest", "nipples", "pubes", "genitals"].filter(key => bare || (["chest", "nipples"].includes(key) ? !(doll.top || doll.outfit.bra || doll.outfit.corset) : !(doll.diaper || doll.outfit.bottom)));
    const bodyLayers = groups.flatMap(key => state.catalog.appearance[key].find(choice => choice.id === $(key).value)?.layers || []);
    doll = { ...doll, player, stance, base: state.catalog.bases[player.shape][stance], bodyLayers,
      ...(bare ? { diaper: null, outfit: {}, top: null } : {}) };
  }
  drawDoll($("doll"), state.doll).catch(error => notice(error.message));
  if (menus.isCharacter()) drawDoll($("creator-doll"), doll).catch(error => notice(error.message));
} // Draft appearance is local until saved; the optional bare preview never unequips owned clothing or changes care state.

const countdown = (due, now) => {
  const seconds = Math.max(0, Math.ceil((due - now) / 1000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

function renderCare() {
  const d = state.doll, c = d.player.care, bulk = d.diaper?.bulk || 0;
  $("excitement").max = d.excitementRules.max; $("excitement").value = d.player.excitement;
  $("excitement-label").textContent = `${Math.round(d.player.excitement)} / ${d.excitementRules.max}`;
  $("excitement-rhythm").textContent = `Builds by ${d.excitementRules.gainPerHour} per hour. Buildup pauses while a toy is active.`;
  $("wetness").max = bulk || 1; $("wetness").value = Math.min(d.usedBulk, bulk || 1);
  $("wetness-label").textContent = `${d.usedBulk} / ${bulk} bulk`;
  $("accident-counts").textContent = `${c.wetness} wetting${c.wetness === 1 ? "" : "s"} · ${c.mess} messy accident${c.mess === 1 ? "" : "s"}. Each messy accident uses ${d.messyRules.bulkPerAccident} bulk.`;
  $("leak-status").textContent = !d.diaper ? "Diaper-free. Accidents will need a baby wipe." : c.leaking ? c.needsWipe ? "Leaking — use one baby wipe before changing." : "Cleaned up — ready for a fresh change." : c.uncomfortable ? "Full and uncomfortable — no leak yet." : c.mess ? "Messy — a fresh change burns this diaper." : c.wetness ? "Wet, with room left. A change now burns this diaper." : "Fresh and comfortable.";
  $("overflow-status").textContent = d.diaper && d.overflow.full ? `${d.overflow.excess} over capacity · ${d.overflow.nextLeakChance}% leak chance on the next accident` : "";
  $("leak-status").className = c.leaking ? "leaking" : "";
  $("pet-reminders").checked = c.reminders; $("messy-mode").checked = c.messyMode;
  renderTimers();
  $("cleanup-status").textContent = c.needsWipe ? `Cleanup needed: ${c.bodyWetness} wet and ${c.bodyMess} messy accident${c.bodyWetness + c.bodyMess === 1 ? "" : "s"}. Use one wipe before dressing.` : "No body cleanup needed.";
  $("wipe-stock").textContent = `${d.supplies.wipes} baby wipe${d.supplies.wipes === 1 ? "" : "s"} available`;
  $("remove-diaper").dataset.unavailable = String(!d.diaper);
  $("use-wipe").dataset.unavailable = String(!c.needsWipe || d.supplies.wipes < 1);
  const camera = $("buttcam"), cameraUrl = `/littlepottchi/api/buttcam?state=${encodeURIComponent(d.buttcam.image + c.revision)}`;
  if (camera.getAttribute("src") !== cameraUrl) {
    camera.hidden = true; camera.onload = () => { camera.hidden = false; }; camera.onerror = () => notice("The diaper camera could not load. Refresh to retry."); camera.src = cameraUrl;
  }
  camera.alt = d.buttcam.label; $("buttcam-note").textContent = [d.buttcam.label,d.buttcam.note].filter(Boolean).join(" · ");
} // Show actual capacity and only replacement designs currently available to this account.

function renderTimers() {
  const d = state.doll, c = d.player.care;
  $("toy-status").textContent = c.toy ? `${c.toy.name} active · ${countdown(c.toy.finishesAt, d.now)}` : c.completedToy ? "Toy session complete" : "Settled · no active toy";
  $("activity-status").textContent = c.task ? `${c.task.kind === "play" ? "Playing" : "Resting"} · ${countdown(c.task.finishesAt, d.now)}` : c.completed ? "Activity finished" : "Ready to play";
  $("care-timers").replaceChildren(...Object.entries({ feed: "Food", water: "Water", play: "Play", rest: "Rest" }).map(([kind, label]) => node("li", `${label}: ${c.task?.kind === kind ? "in progress" : c.due[kind] <= d.now ? "ready now" : `in ${countdown(c.due[kind], d.now)}`}`)));
} // Display care and activity countdowns only; accident schedules stay out of the player interface.

function updateButtons() {
  document.querySelectorAll("button").forEach(button => { button.disabled = busy || button.dataset.unavailable === "true"; });
  if (state) {
    $("roll").disabled = busy || !state.shop.enabled || !!state.shop.pending || state.coins === null || state.coins < state.shop.rollPrice;
    document.querySelectorAll("[data-care]").forEach(button => { button.disabled = busy || (state.doll.player.cooldowns[button.dataset.care] || 0) > state.doll.now ||
      (!!state.doll.player.care.task && ["play", "rest"].includes(button.dataset.care)) || (button.dataset.care === "change" && state.doll.player.care.needsWipe); });
    $("pet-reminders").disabled = busy;
    $("messy-mode").disabled = busy;
    $("stop-toy").disabled = busy || !state.doll.player.care.toy;
    $("stop-toy").hidden = !state.doll.player.care.toy;
    menus.update(busy);
  }
} // Keep duplicate clicks out of the UI; the payment journal also enforces idempotency on the server.

async function run(work) {
  if (busy) return;
  busy = true; notice(""); updateButtons();
  try { await work(); } catch (error) { notice(error.message); }
  finally { busy = false; updateButtons(); }
}

async function dollAction(input) {
  petGeneration++;
  state.doll = await api("/littlepottchi/api/doll", input); renderDoll(); renderGallery();
  const burned = state.doll.burned;
  if (burned) {
    const name = state.diapers.find(row => row.id === burned)?.name || burned;
    const left = state.doll.ownedDiapers.find(row => row.design === burned)?.available || 0;
    notice(`The used ${name} went in the fire. ${left} available in your collection.`);
  }
} // Pet actions never debit the wallet; cleanup consumes an already-purchased wipe and a soiled diaper atomically on the server.

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
    const active = result.item.supply || state.catalog.clothes.some(item => item.id === result.item.id);
    $("prize-name").textContent = active ? result.item.name : "Retired design"; $("prize-rarity").textContent = active ? result.item.rarity : "";
    $("prize-copy").textContent = result.action === "sell" ? `Sold one copy for ${result.amount} coins.` : `One copy added to your wardrobe for ${result.amount} coins.`;
    if (result.item.supply) $("prize-copy").textContent = `One baby wipe added to your care supplies for ${result.amount} coins.`;
    $("prize-art").getContext("2d").clearRect(0, 0, 160, 150);
    if (active) await thumbnail($("prize-art"), result.item);
    else $("prize-copy").textContent = "Your previous payment is resolved. This retired design is no longer available in the wardrobe.";
    $("reveal").showModal();
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
  const visibleOutfit = { ...state.doll.outfit, ...(state.doll.top ? { top:state.doll.top } : {}) };
  $("equipped").replaceChildren(...Object.entries(visibleOutfit).map(([slot, item]) => {
    const button = node("button", `${labels[slot]} · ${item.name || state.diapers.find(d => d.id === item.id)?.name || item.id} ×`);
    button.dataset.unequip = slot;
    button.addEventListener("click", () => run(() => dollAction({ action: "equip", slot, design: null }))); return button;
  }));
  if (state.doll.top?.id !== state.doll.starterTop.id) {
    const starter = node("button", "Wear starter shirt"); starter.id = "wear-starter-shirt";
    starter.addEventListener("click", () => run(() => dollAction({action:"equip",slot:"top",design:state.doll.starterTop.id})));
    $("equipped").append(starter);
  } // Expose the free default shirt alongside equipped pieces, including an explicit way to restore it.
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  galleryPage = Math.min(galleryPage, pages - 1);
  $("gallery-status").textContent = filtered.length ? `${galleryPage * pageSize + 1}–${Math.min((galleryPage + 1) * pageSize, filtered.length)} of ${filtered.length} pieces` : "0 pieces";
  $("previous-page").dataset.unavailable = String(galleryPage === 0);
  $("next-page").dataset.unavailable = String(galleryPage >= pages - 1);
  $("gallery").replaceChildren(...filtered.slice(galleryPage * pageSize, (galleryPage + 1) * pageSize).map(item => {
    const card = node("article", null, "item"), art = node("canvas"); art.width = 160; art.height = 150; art.setAttribute("aria-label", item.name); art.setAttribute("role", "img");
    card.append(art, node("span", item.rarity, "pill"), node("h3", item.name));
    const count = owned.get(item.id);
    card.append(node("p", diapersView ? `${item.stance === "wide" ? "Wide" : "Regular"} stance · ${count?.quantity || 0} owned` : `${labels[item.slot]} · ${count?.quantity || 0} owned`));
    if (item.fitNote) card.append(node("p", item.fitNote));
    if (diapersView) card.append(node("p", `Bulk ${item.bulk} · wettings use 1, messy accidents use ${state.doll.messyRules.bulkPerAccident}`));
    if (view === "catalog") card.append(node("p", `${item.chance.toFixed(3)}% per roll`));
    if (count?.available > 0) {
      const needsWipe = diapersView && state.doll.player.care.needsWipe;
      const wear = node("button", needsWipe ? "Use a baby wipe first" : "Wear this"); wear.dataset.unavailable = String(needsWipe);
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
} // Render names as text and keep catalog thumbnails separate from automatically fitted doll layers.

$("login").href = shopPage ? "/clothes/login" : "/littlepottchi/login";
$("slot").replaceChildren(node("option", "Every piece"), ...Object.entries(labels).filter(([key]) => key !== "diaper").map(([key, label]) => {
  const option = node("option", label); option.value = key; return option;
}));
$("slot").options[0].value = "";
for (const [id, delta] of [["previous-page", -1], ["next-page", 1]]) $(id).addEventListener("click", () => { galleryPage += delta; renderGallery(); });
$(shopPage ? "shop-link" : "pet-link").setAttribute("aria-current", "page");
document.body.classList.toggle("pet-game", !shopPage);
const menus = createGameMenu({ getState:()=>state, act:dollAction, execute:run, error:notice, shopPage,
  characterOpen:()=>{ fillAppearance(); renderAppearance(); },
  characterClose:()=>{ $("preview-body").checked=false; appearanceDirty=false; renderAppearance(); },
});
$("roll-panel").hidden = !shopPage; $("care-panel").hidden = shopPage;
$("buttcam-panel").hidden = shopPage; // The pet dashboard shows its protected camera between the doll and care controls on phones.
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
$("remove-diaper").addEventListener("click", () => run(() => dollAction({ action: "equip", slot: "diaper", design: null })));
$("use-wipe").addEventListener("click", () => run(() => dollAction({ action: "wipe" })));
$("stop-toy").addEventListener("click", () => run(() => dollAction({ action: "stop-toy" })));
$("messy-mode").addEventListener("change", () => run(async () => {
  try { await dollAction({ action: "messy-mode", enabled: $("messy-mode").checked }); }
  finally { $("messy-mode").checked = state.doll.player.care.messyMode; }
})); // Save the mode through the same authenticated care endpoint and restore the checkbox after a failed request.
$("pet-reminders").addEventListener("change", () => run(async () => {
  try { await dollAction({ action: "reminders", enabled: $("pet-reminders").checked }); }
  finally { $("pet-reminders").checked = state.doll.player.care.reminders; }
}));
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
  view = button.dataset.view; galleryPage = 0; document.querySelectorAll("[data-view]").forEach(other => other.setAttribute("aria-pressed", String(other === button))); renderGallery();
}));
for (const id of ["search", "slot", "rarity"]) $(id).addEventListener("input", () => { galleryPage = 0; if (state) renderGallery(); });
$("hair").addEventListener("change", () => { syncHairChoices(); appearanceDirty = true; renderAppearance(); });
for (const id of ["hair-style", "hair-color"]) $(id).addEventListener("change", () => {
  const hair = state.catalog.appearance.hair;
  $("hair").value = (hair.find(choice => choice.style === $("hair-style").value && choice.color === $("hair-color").value) || hair.find(choice => choice.style === $("hair-style").value)).image;
  syncHairChoices(); appearanceDirty = true; renderAppearance();
});
for (const id of ["shape", "face", ...anatomyKeys]) $(id).addEventListener("change", () => { appearanceDirty = true; renderAppearance(); });
$("preview-body").addEventListener("change", renderAppearance);
$("appearance").addEventListener("submit", event => { event.preventDefault(); run(async () => {
  await dollAction({ action: "appearance", name: $("name").value, gender: $("gender").value, shape: $("shape").value, hair: $("hair").value, face: $("face").value,
    anatomy: Object.fromEntries(anatomyKeys.map(key => [key, $(key).value])) });
  appearanceDirty = false; menus.close(); renderAppearance();
}); });
for (const id of ["close-reveal", "prize-done"]) $(id).addEventListener("click", () => $("reveal").close());
let polling = false;
setInterval(() => { if (state) { state.doll.now += 1000; updateButtons(); renderTimers(); } }, 1000);
setInterval(async () => {
  if (!state || busy || polling || document.hidden) return;
  polling = true; const generation = petGeneration;
  try { const pet = await api("/littlepottchi/api/pet"); if (!busy && generation === petGeneration) { state.doll = pet; renderDoll(); renderGallery(); updateButtons(); } }
  catch (error) { notice(error.message); } finally { polling = false; }
}, 15000); // Poll care without refreshing the wallet or overwriting unfinished character-builder edits.
run(refresh);
