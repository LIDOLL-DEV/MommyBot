import { thumbnail } from "./doll.js";

const $ = id => document.getElementById(id);
const element = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };

function symbol(canvas, kind) {
  const c = canvas.getContext("2d"); c.fillStyle = "#f5e5ef"; c.beginPath(); c.arc(80,75,52,0,Math.PI*2); c.fill();
  c.fillStyle = "#94709c"; c.strokeStyle = "#94709c"; c.lineWidth = 6;
  if (kind === "rest") { c.beginPath(); c.arc(77,73,31,0,Math.PI*2); c.fill(); c.fillStyle="#f5e5ef"; c.beginPath(); c.arc(92,62,28,0,Math.PI*2); c.fill(); }
  else if (kind === "play") { c.beginPath(); c.moveTo(80,35); c.lineTo(108,67); c.lineTo(80,99); c.lineTo(52,67); c.closePath(); c.fill(); c.beginPath(); c.moveTo(80,99); c.quadraticCurveTo(110,117,71,128); c.stroke(); }
  else { c.beginPath(); c.roundRect(64,kind === "pocket" ? 49 : 32,32,kind === "pocket" ? 52 : 90,16); c.fill(); c.fillStyle="#fffdfa"; c.beginPath(); c.arc(80,76,5,0,Math.PI*2); c.fill(); if(kind === "dual") { c.beginPath(); c.arc(111,53,13,0,Math.PI*2); c.stroke(); } }
} // Small native canvas illustrations cover actions that have no supplied item artwork.

export function createGameMenu({ getState, act, execute, error, characterOpen, characterClose, shopPage }) {
  const dialog = $("game-menu"), content = $("menu-content");
  const panels = { character: $("builder"), settings: $("settings-panel"), ...(!shopPage ? { wardrobe: $("wardrobe-panel") } : {}) };
  for (const panel of Object.values(panels)) { content.append(panel); panel.hidden = true; }
  let kind = null, selected = null, signature = "", opener = null;

  function rows() {
    const s = getState(), d = s.doll, c = d.player.care;
    if (kind === "change") {
      const owned = new Map(d.ownedDiapers.map(row => [row.design,row]));
      return s.catalog.diapers.filter(item => item.id === "cloud-tapes" || owned.has(item.id)).map(item => ({
        id:item.id, name:s.diapers.find(row => row.id === item.id).name, art:item,
        detail:`Bulk ${item.bulk} · ${item.stance === "wide" ? "Wide" : "Regular"} stance`,
        tag:item.id === "cloud-tapes" ? "Free starter" : `${owned.get(item.id).available} available`,
        wearing:d.diaper?.id === item.id, blocked:item.id !== "cloud-tapes" && !owned.get(item.id)?.available,
        action:{action:"change",design:item.id},
      }));
    }
    if (kind === "food") return s.catalog.foods.map(food => ({id:food.id,name:food.name,image:food.image,detail:`+${food.fullness} fullness · +${food.joy} happiness`,blocked:(d.player.cooldowns.feed || 0)>d.now,action:{action:"feed",food:food.id}}));
    if (kind === "toys") return d.excitementRules.toys.map(toy => ({id:toy.id,name:toy.name,symbol:toy.id,detail:`${toy.duration/60000} min · ${toy.relief} relief`,blocked:!!c.toy || d.player.excitement<=0,action:{action:"toy",toy:toy.id}}));
    if (kind === "routine") return [{id:"play",name:"Play",symbol:"play"},{id:"rest",name:"Rest",symbol:"rest"}].map(row => ({...row,
      detail:`${d.careRules[row.id].duration/60000} min · +${row.id === "play" ? d.careRules.play.rewards.joy : d.careRules.rest.rewards.energy} ${row.id === "play" ? "happiness" : "energy"}`,
      blocked:!!c.task || (d.player.cooldowns[row.id]||0)>d.now,action:{action:row.id}}));
    return [];
  } // Resolve choices from current account ownership each time; the backend remains authoritative on confirmation.

  function update(busy = false) {
    if (!dialog.open || !getState()) return;
    $("close-menu").disabled = false;
    if (panels[kind]) return;
    const all = rows(), d = getState().doll, term = $("menu-search").value.trim().toLowerCase();
    if (!all.some(row => row.id === selected && !row.blocked)) selected = all.find(row => !row.blocked)?.id || null;
    const visible = all.filter(row => kind !== "change" || row.name.toLowerCase().includes(term));
    const next = JSON.stringify([kind,all.map(({id,detail,tag,wearing,blocked}) => ({id,detail,tag,wearing,blocked})),term]);
    if (next !== signature) {
      signature = next; const focused = document.activeElement?.dataset.choice;
      $("menu-choices").replaceChildren(...visible.map(row => {
        const card = element("button",null,"picture-choice"); card.type="button"; card.dataset.choice=row.id;
        card.setAttribute("aria-pressed",String(row.id===selected));
        if (row.image) { const img=element("img"); img.src=`/clothes/art/${row.image}`; img.alt=""; card.append(img); }
        else { const canvas=element("canvas"); canvas.width=160; canvas.height=150; canvas.setAttribute("aria-hidden","true"); card.append(canvas); if(row.art) thumbnail(canvas,row.art).catch(e=>error(e.message)); else symbol(canvas,row.symbol); }
        card.append(element("strong",row.name),element("small",row.detail));
        if (row.tag || row.wearing) card.append(element("span",[row.tag,row.wearing ? "Wearing" : ""].filter(Boolean).join(" · "),"pill"));
        card.addEventListener("click",()=>{ selected=row.id; update(); });
        return card;
      }));
      if (!visible.length) $("menu-choices").append(element("p","No matching diapers.","empty"));
      if (focused) [...$("menu-choices").querySelectorAll("button")].find(button=>button.dataset.choice===focused)?.focus();
    }
    for (const button of $("menu-choices").querySelectorAll("button")) {
      button.disabled=busy || !!all.find(row=>row.id===button.dataset.choice)?.blocked;
      button.setAttribute("aria-pressed",String(button.dataset.choice===selected));
    }
    const choice=all.find(row=>row.id===selected), cleanup=kind==="change" && d.player.care.needsWipe;
    $("change-cleanup").hidden=!cleanup;
    $("change-cleanup-text").textContent=d.supplies.wipes ? "Cleanup needed. Use one wipe, then choose a fresh diaper." : "Cleanup needed. Buy a wipe at Diaper Atelier first.";
    $("menu-wipe").disabled=busy || !d.supplies.wipes;
    $("selection-label").textContent=choice?.name || "No action available right now.";
    $("confirm-choice").textContent={change:"Fresh Change",food:"Feed",toys:"Activate",routine:"Start"}[kind] || "Use selected";
    $("confirm-choice").disabled=busy || !choice || choice.blocked || cleanup;
    $("menu-hint").textContent=kind==="change" ? "Choose an unlocked diaper. Fresh changes reuse the design." : kind==="food" ? "Choose a snack. Pantry food is free." : kind==="toys" ? d.player.care.toy ? "A toy is already active. Stop it on the dashboard to switch." : "Choose a reusable toy. All sessions are free." : d.player.care.task ? "An activity is already running." : "Choose a timed activity.";
  } // Preserve keyboard focus and selection during background updates; recheck cleanup before enabling the final action.

  function open(next, source) {
    if (!getState()) return;
    if (next === "wardrobe" && shopPage) { $("wardrobe-panel").scrollIntoView({block:"start"}); return; }
    opener=source; kind=next; signature="";
    selected=next==="change" ? getState().doll.diaper?.id || "cloud-tapes" : null;
    $("menu-search").value=""; $("menu-search").hidden=next!=="change";
    $("menu-notice").hidden=true;
    $("menu-title").textContent={change:"Fresh Change",food:"Pantry",toys:"Toys",routine:"Play & Rest",wardrobe:"Wardrobe",character:"Character",settings:"Care & Settings"}[next];
    $("picker-panel").hidden=Boolean(panels[next]);
    for (const [key,panel] of Object.entries(panels)) panel.hidden=key!==next;
    dialog.dataset.menu=next;
    if (!dialog.open) dialog.showModal();
    if (next==="character") characterOpen();
    update(); $("close-menu").focus();
  } // Native dialogs trap keyboard focus, support Escape and keep the dashboard visible behind the menu.

  $("close-menu").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{ if(kind==="character") characterClose(); kind=null; opener?.focus(); });
  $("menu-search").addEventListener("input",()=>update());
  $("confirm-choice").addEventListener("click",()=>execute(async()=>{
    const choice=rows().find(row=>row.id===selected);
    if (!choice || choice.blocked || (kind==="change" && getState().doll.player.care.needsWipe)) return;
    await act(choice.action); dialog.close();
  }));
  $("menu-wipe").addEventListener("click",()=>execute(async()=>{ await act({action:"wipe"}); update(); }));
  document.querySelectorAll("[data-menu]").forEach(button=>button.addEventListener("click",()=>open(button.dataset.menu,button)));
  return { open, update, close:()=>dialog.close(), isCharacter:()=>dialog.open && kind==="character" };
}
