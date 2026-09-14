const $ = id => document.getElementById(id);
let data = null, busy = false, modalControl = null;
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
function notice(text = "") { $("notice").textContent = text; $("notice").hidden = !text; }
function lock(value) { busy = value; for (const el of document.querySelectorAll("button,select,input")) el.disabled = value; }
async function api(path, input) {
  const response = await fetch(`/touhou/api/${path}`, { credentials:"same-origin", cache:"no-store", signal:AbortSignal.timeout(20000),
    ...(input ? { method:"POST", headers:{"Content-Type":"application/json","X-CSRF-Token":data?.csrf || ""},body:JSON.stringify(input) } : {}) });
  let result; try { result = await response.json(); } catch { throw Error("The server did not return a game response. Refresh and retry any pending payment."); }
  if (!response.ok) { if(response.status === 401) { $("sign-in").hidden=false;$("game").hidden=true;data=null; } throw Error(result.error || "This action could not finish."); }
  return result;
} // No account IDs or wallet tokens are accepted from browser storage.
function textDescription(text) {
  $("description").replaceChildren();
  for (const line of text.split("\n")) { const p=node("p"); for (const [i,part] of line.split("**").entries()) p.append(node(i%2 ? "strong" : "span",part)); $("description").append(p); }
} // Support the existing menu's bold text without interpreting any user or catalog text as HTML.
function render() {
  if(!data) return;
  $("sign-in").hidden=true;$("game").hidden=false;$("logout").hidden=false;
  $("player-id").textContent = `Your player ID: ${data.playerId || ""}. Share it with friends for gifts and trades.`;
  $("greeting").textContent=`Welcome, ${data.username}.`;
  $("balance").textContent=data.balance ? `${data.balance.coins.toLocaleString()} LiDollcoins · ${data.balance.stars.toLocaleString()} stars` : "Wallet unavailable";
  if(data.guilds) { $("guild").replaceChildren(new Option("Choose a play space…",""));for(const guild of data.guilds) $("guild").append(new Option(guild.name,guild.id)); if(!data.guilds.length) notice("No play spaces are available. Try Refresh."); }
  $("trader").hidden=!data.panel;$("offers-card").hidden=!data.panel;
  if(!data.panel) return;
  $("server-name").textContent=data.guild.name;$("trader-title").textContent=data.panel.title;textDescription(data.panel.text);
  $("portraits").replaceChildren();for(const src of data.panel.images) {const img=node("img");img.src=src;img.alt="Touhou character artwork";$("portraits").append(img);}
  $("controls").replaceChildren();
  for(const items of data.panel.rows) {
    const row=node("div",undefined,"control-row");
    for(const item of items) {
      if(item.type===2) { const button=node("button",item.label,item.style===1?"primary":item.style===3?"primary success":item.style===4?"quiet danger":"quiet");button.type="button";button.disabled=Boolean(item.disabled);button.addEventListener("click",()=>act({control:item.custom_id}));row.append(button); }
      else if(item.type===3) { const select=node("select");select.setAttribute("aria-label",item.placeholder || "Choose an item");select.append(new Option(item.placeholder || "Choose…",""));for(const option of item.options) select.append(new Option(`${option.label}${option.description ? ` · ${option.description}` : ""}`,option.value));select.addEventListener("change",()=>{if(select.value)act({control:item.custom_id,value:select.value});});row.append(select); }
      else if(item.type===5) { const form=node("form"),label=node("label",data.guild?.id === "public" ? "Recipient's player ID" : "Recipient's Discord user ID"),input=node("input"),button=node("button","Choose player","primary");input.type="text";input.pattern=data.guild?.id === "public" ? "(web_[a-f0-9]{32}|[0-9]{17,20})" : "[0-9]{17,20}";input.required=true;input.maxLength=36;label.append(input);button.type="submit";form.append(label,node("p",data.guild?.id === "public" ? "Ask your friend for the player ID shown in their trader. They must open this play space first." : "Copy their user ID from Discord with Developer Mode enabled.","muted fine"),button);form.addEventListener("submit",event=>{event.preventDefault();act({control:item.custom_id,value:input.value});});row.append(form); }
    }
    $("controls").append(row);
  }
  $("offers").replaceChildren();
  for(const offer of data.offers || []) { const box=node("div",undefined,"offer");box.append(node("p",`User ${offer.sender_id} offers ${offer.offered} for your ${offer.requested}.`));for(const decision of ["accept","decline"]) {const button=node("button",decision==="accept"?"Accept swap":"Decline",decision==="accept"?"primary":"quiet");button.type="button";button.addEventListener("click",()=>act({action:"offer",offer:offer.id,decision}));box.append(button);}$("offers").append(box); }
  if(!data.offers?.length) $("offers").append(node("p","No pending offers. Press Refresh to check again.","muted"));
  if(data.panel.notice) notice(data.panel.notice);
  modalControl=data.panel.modal?.custom_id || null;
  if(modalControl) { $("price-title").textContent=data.panel.modal.title; if(!$("price-dialog").open) {$("price").value="";$("price-dialog").showModal();} }
  else $("price-dialog").close();
} // Draw the validated server menu as native web controls, including battles, trade selection and price entry.
async function refresh() {const guild=$("guild").value;const result=await api(`state${guild?`?guild=${encodeURIComponent(guild)}`:""}`);data={...data,...result};if(guild)delete data.guilds;render();if(data.walletError)notice(data.walletError);if(!guild&&result.guilds?.length===1&&result.guilds[0].id==="public") {$("guild").value="public";await refresh();}}
async function act(input) {
  if(busy||!data)return;lock(true);notice();
  try { const result=await api("action",{...input,guild:$("guild").value});data={...data,...result};render();await refresh(); }
  catch(error) {notice(error.name==="TimeoutError"||error instanceof TypeError?"Connection interrupted. Refresh, then use Retry pending payment if needed.":error.message);}
  finally {lock(false);}
} // Server menu revisions and durable receipts protect retries; a failed request never automatically repeats a purchase.
$("guild").addEventListener("change",async()=>{if(busy)return;lock(true);notice();try{await refresh();}catch(error){notice(error.message);}finally{lock(false);}});
$("refresh").addEventListener("click",async()=>{if(busy)return;lock(true);notice();try{await refresh();}catch(error){notice(error.message);}finally{lock(false);}});
$("restart").addEventListener("click",()=>act({action:"restart-menu"}));
$("price-form").addEventListener("submit",event=>{event.preventDefault();act({control:modalControl,value:$("price").value});});
$("price-cancel").addEventListener("click",()=>act({action:"cancel-modal"}));
$("price-dialog").addEventListener("cancel",event=>{event.preventDefault();act({action:"cancel-modal"});}); // Escape dismisses the saved modal as well as its browser presentation.
$("logout").addEventListener("click",async()=>{if(busy)return;lock(true);try{await api("logout",{});location.reload();}catch(error){notice(error.message);lock(false);}});
refresh().catch(error=>notice(error.message));
