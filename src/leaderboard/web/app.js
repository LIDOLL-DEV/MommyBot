const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat();
let entries = [];

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
} // Treat all player names as text, including names containing HTML or markup.

function render() {
  const query = byId("search").value.trim().toLocaleLowerCase();
  const visible = entries.filter(entry => entry.username.toLocaleLowerCase().includes(query));
  const rows = document.createDocumentFragment();
  for (const entry of visible) {
    const row = element("tr");
    row.append(element("td", entry.rank === null ? "—" : `#${entry.rank}`, "rank"),
      element("td", entry.username, "player-name"),
      element("td", entry.coins === null ? "Unavailable" : number.format(entry.coins), `amount${entry.coins === null ? " unavailable" : ""}`));
    rows.append(row);
  }
  byId("players").replaceChildren(rows);
  byId("empty").hidden = visible.length > 0;
  byId("empty").textContent = entries.length ? "No players match that name. Try another little search." : "The garden is waiting for its first player. Connect through /menu to join!";
} // Search every registered player locally while preserving their global rank.

function renderPodium() {
  const cards = entries.filter(entry => entry.rank !== null).slice(0, 3).map(entry => {
    const card = element("article", undefined, "podium-card");
    card.append(element("span", entry.rank === 1 ? "👑" : entry.rank === 2 ? "🌷" : "🌸", "medal"),
      element("small", `Rank #${entry.rank}`), element("h3", entry.username),
      element("strong", number.format(entry.coins)), element("small", "LiDollcoins"));
    return card;
  });
  byId("podium").replaceChildren(...cards);
  byId("podium").hidden = cards.length === 0;
} // Celebrate the first three readable balances, with shared ranks for ties.

async function refresh() {
  const button = byId("refresh"), notice = byId("notice");
  button.disabled = true; button.textContent = "Refreshing…";
  notice.className = ""; notice.textContent = "Gathering the coin counts…";
  try {
    const response = await fetch("/leaderboard/api/balances", { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    entries = data.entries;
    const available = entries.filter(entry => entry.coins !== null).length;
    byId("summary").textContent = `${number.format(entries.length)} registered ${entries.length === 1 ? "player" : "players"} · ${number.format(available)} ranked`;
    notice.textContent = available < entries.length ? "Some balances are unavailable. Those players are listed below the rankings." : "All caught up. A little sparkle for everyone!";
    byId("updated").textContent = `Checked ${new Date(data.updatedAt).toLocaleString()} · Updates at most once a minute`;
    render(); renderPodium();
  } catch {
    notice.className = "error";
    notice.textContent = "The coin garden couldn't refresh. Please try again shortly.";
    if (entries.length) notice.textContent += " Previously loaded balances are still shown.";
    else byId("summary").textContent = "Waiting for coin balances";
  } finally { button.disabled = false; button.textContent = "↻ Refresh"; }
} // Keep a failed refresh distinct from an empty leaderboard, and preserve the last successful view.

byId("search").addEventListener("input", render);
byId("refresh").addEventListener("click", refresh);
void refresh(); // Load on arrival; manual refresh shares the server's one-minute cache.
