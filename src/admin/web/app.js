const $ = id => document.getElementById(id);
let csrf = "", selected = "", state;
const notice = (text, error = false) => { $("notice").textContent = text; $("notice").classList.toggle("error", error); };
async function api(path, input) {
  const response = await fetch(`/admin/api/${path}`, input ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(input) } : {});
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) { $("login").hidden = false; $("panel").hidden = true; $("logout").hidden = true; }
    throw new Error(result.error || "The admin panel could not complete that request.");
  }
  return result;
} // Keep credentials in HttpOnly cookies and use the session's CSRF token for every write.
function options(id, items, empty = null) {
  const select = $(id); select.replaceChildren();
  if (empty) select.add(new Option(empty, ""));
  for (const item of items) select.add(new Option(item.name, item.id));
} // Render Discord names as text, never as HTML supplied by a server or member.
function addChoice() {
  const container = $("roleChoices");
  if (container.children.length >= 20) { notice("Save these choices before adding more (up to twenty per save).", true); return; }
  const row = document.createElement("div"), emojiLabel = document.createElement("label"), roleLabel = document.createElement("label");
  const emoji = document.createElement("input"), role = document.createElement("select"), remove = document.createElement("button");
  row.className = "role-choice"; emojiLabel.textContent = "Emoji"; roleLabel.textContent = "Role";
  emoji.className = "choice-emoji"; emoji.required = true; emoji.maxLength = 80; emoji.placeholder = "🌸 or :emoji_name:";
  role.className = "choice-role"; role.required = true; role.add(new Option("Choose a role", ""));
  for (const item of state.roles) role.add(new Option(item.name, item.id));
  remove.type = "button"; remove.textContent = "Remove choice";
  remove.addEventListener("click", () => { row.remove(); if (!container.children.length) addChoice(); });
  emojiLabel.append(emoji); roleLabel.append(role); row.append(emojiLabel, roleLabel, remove); container.append(row);
} // Each row is one independently selectable Discord emoji/role pair; names remain text-only.
function render() {
  const settings = state.settings;
  for (const key of ["chat", "swearJar", "welcomes"]) $(key).checked = settings[key];
  $("starEnabled").checked = settings.starboard.enabled;
  options("starChannel", state.channels, "Choose a channel"); $("starChannel").value = settings.starboard.channel;
  options("sources", state.channels.filter(channel => channel.public));
  for (const option of $("sources").options) option.selected = settings.starboard.sources.includes(option.value);
  $("starEmoji").value = settings.starboard.emoji; $("threshold").value = settings.starboard.threshold;
  const previousChannel = $("roleChannel").value;
  options("roleChannel", state.channels);
  if (state.channels.some(channel => channel.id === previousChannel)) $("roleChannel").value = previousChannel;
  if (!$("roleChoices").children.length) addChoice();
  $("connection").textContent = `${state.status.connected ? "● Connected" : "○ Connecting"} · ${state.status.ping} ms · Chat channel: ${state.status.chatChannel} · Swear jar: ${state.status.swearJarAvailable ? "available" : "disabled in deployment"} · Welcomes: ${state.status.welcomesAvailable ? "available" : "disabled in deployment"}`;
  $("bindings").replaceChildren();
  for (const binding of state.bindings) {
    const row = document.createElement("li"), label = document.createElement("span"), link = document.createElement("a"), remove = document.createElement("button");
    const role = state.roles.find(item => item.id === binding.role_id)?.name || binding.role_id;
    label.textContent = `${binding.emoji} → ${role} · `;
    link.href = `https://discord.com/channels/${selected}/${binding.channel_id}/${binding.message_id}`;
    link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "View message"; label.append(link);
    remove.textContent = "Remove mapping";
    remove.addEventListener("click", () => run(async () => {
      if (!confirm("Remove this mapping? Existing roles and message reactions will stay.")) return;
      await action({ action: "reaction-delete", id: binding.id });
    }));
    row.append(label, remove); $("bindings").append(row);
  }
  if (!state.bindings.length) $("bindings").textContent = "No reaction roles yet.";
  $("audit").replaceChildren();
  for (const entry of state.audit) {
    const row = document.createElement("li"), text = document.createElement("span"), meta = document.createElement("small");
    text.textContent = `${entry.action} · ${entry.detail}`;
    meta.textContent = `${new Date(entry.created).toLocaleString()} · ${entry.actor}`; text.append(meta); row.append(text); $("audit").append(row);
  }
  if (!state.audit.length) $("audit").textContent = "Your server's changes will appear here.";
} // Show saved server settings, mappings and a compact audit history without rendering untrusted markup.
async function loadGuild() {
  if (selected !== $("guild").value) { $("roleChoices").replaceChildren(); $("message").value = ""; }
  selected = $("guild").value;
  if (!selected) return;
  state = await api(`state?guild=${encodeURIComponent(selected)}`); render();
}
async function action(input) {
  const result = await api("action", { ...input, guild: selected });
  await loadGuild(); notice(result.message);
}
async function run(work) {
  document.querySelectorAll("button,fieldset,#guild").forEach(node => { node.disabled = true; });
  try { await work(); } catch (error) { notice(error.message, true); }
  finally { document.querySelectorAll("button,fieldset,#guild").forEach(node => { node.disabled = false; }); }
} // Prevent overlapping saves while retaining clear, accessible status messages.
$("settings").addEventListener("submit", event => { event.preventDefault(); void run(() => action({ action: "settings",
  chat: $("chat").checked, swearJar: $("swearJar").checked, welcomes: $("welcomes").checked,
  starboard: { enabled: $("starEnabled").checked, channel: $("starChannel").value, sources: [...$("sources").selectedOptions].map(option => option.value), emoji: $("starEmoji").value, threshold: Number($("threshold").value) },
})); });
$("roleForm").addEventListener("submit", event => { event.preventDefault(); void run(async () => {
  let message = $("message").value.trim(), channel = $("roleChannel").value;
  const link = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/.exec(message);
  if (link) { if (link[1] !== selected) throw new Error("That message belongs to another server."); channel = link[2]; message = link[3]; }
  const choices = [...$("roleChoices").children].map(row => ({ role: row.querySelector(".choice-role").value, emoji: row.querySelector(".choice-emoji").value }));
  await action({ action: "reaction-add", channel, message, choices });
  $("roleChoices").replaceChildren(); addChoice(); // Keep the message selected so admins can add more choices to it.
}); });
$("addChoice").addEventListener("click", () => { addChoice(); $("roleChoices").lastElementChild.querySelector("input").focus(); });
$("guild").addEventListener("change", () => void run(loadGuild));
$("refresh").addEventListener("click", () => void run(loadGuild));
$("sync").addEventListener("click", () => void run(() => action({ action: "sync" })));
$("logout").addEventListener("click", () => void run(async () => { await api("logout", {}); location.assign("/admin/"); }));
void run(async () => {
  const root = await api("state"); csrf = root.csrf;
  $("logout").hidden = false;
  if (!root.guilds.length) { notice("No administrable servers found. Your linked Discord account needs Administrator permission in a server with MommyBot.", true); return; }
  options("guild", root.guilds); $("login").hidden = true; $("panel").hidden = false; await loadGuild();
}); // Bootstrap access from live server permissions rather than assuming a signed-in member is an administrator.
