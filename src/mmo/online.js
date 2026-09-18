import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { escapeMarkdown, PermissionFlagsBits } from "discord.js";

export function onlineConfig(env = process.env) {
  if (env.LIDOLLMMO_ONLINE_ENABLED !== "true") return null;
  const url = new URL(env.LIDOLLMMO_ONLINE_URL);
  const [a, b] = url.hostname.split(".").map(Number);
  const privateHost = ["localhost", "[::1]"].includes(url.hostname) || isIP(url.hostname) === 4 && (a === 127 || a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31);
  if (!(url.protocol === "https:" || url.protocol === "http:" && privateHost) || url.username || url.password || url.search || url.hash) throw Error("Invalid online feed URL");
  const token = env.MOMMYBOT_ONLINE_TOKEN || "", channel = env.LIDOLLMMO_ONLINE_CHANNEL_ID || "1550612967253352528";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token) || !/^\d{17,20}$/.test(channel)) throw Error("Invalid online feed configuration");
  return { url: url.href, token, channel, filename: "data/mmo-online.db" };
} // The feed uses a dedicated read-only secret; explicit private LAN URLs work without hairpin NAT.

export function joinMessage(stream, event, roleId) {
  const name = escapeMarkdown(event.name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, 80));
  const marker = createHash("sha256").update(`${stream}:${event.id}`).digest("hex");
  return { content: roleId ? `<@&${roleId}>` : undefined, embeds: [{ color: 0xd58cdb, title: "Someone’s here! 🌸", description: `**${name}** just joined **LiDollMMO**. Come say hello!`,
    footer: { text: `LiDollMMO join · ${marker}` } }],
    allowedMentions: { parse: [], users: [], roles: roleId ? [roleId] : [] }, nonce: marker.slice(0, 24), enforceNonce: true };
} // Only the explicitly resolved lidollmmo role may ping; character names cannot mention other users or roles.

export function createOnlinePublisher(client, { env = process.env, config, fetcher = fetch, now = Date.now, logger = console } = {}) {
  try { if (config === undefined) config = onlineConfig(env); }
  catch { logger.error("[LiDollMMO] Announcements disabled: check LIDOLLMMO_ONLINE_URL, MOMMYBOT_ONLINE_TOKEN and channel ID."); return null; }
  if (!config) return null;
  if (config.filename !== ":memory:") mkdirSync(dirname(config.filename), { recursive: true });
  const db = new Database(config.filename); db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS online_feeds(url TEXT NOT NULL,channel TEXT NOT NULL,stream TEXT NOT NULL,cursor INTEGER NOT NULL,PRIMARY KEY(url,channel));
    CREATE TABLE IF NOT EXISTS online_attempts(url TEXT NOT NULL,channel TEXT NOT NULL,stream TEXT NOT NULL,event INTEGER NOT NULL,PRIMARY KEY(url,channel,stream,event));`);
  let stopped = false, active, timer;
  const state = () => db.prepare("SELECT * FROM online_feeds WHERE url=? AND channel=?").get(config.url, config.channel);
  const advance = (stream, cursor) => db.transaction(() => {
    db.prepare("INSERT INTO online_feeds VALUES (?,?,?,?) ON CONFLICT(url,channel) DO UPDATE SET stream=excluded.stream,cursor=excluded.cursor").run(config.url, config.channel, stream, cursor);
    db.prepare("DELETE FROM online_attempts WHERE url=? AND channel=? AND (stream<>? OR event<=?)").run(config.url, config.channel, stream, cursor);
  })(); // Commit cursors and clear attempts together so completed joins survive bot restarts.

  async function page(after) {
    const url = new URL(config.url); url.searchParams.set("after", after); url.searchParams.set("limit", "20");
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("Feed unavailable");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 65536) throw Error("Feed too large"); chunks.push(Buffer.from(chunk)); }
    const result = JSON.parse(Buffer.concat(chunks));
    if (!result || !/^[a-f0-9-]{36}$/.test(result.stream) || !Array.isArray(result.events) || result.events.length > 20 || typeof result.has_more !== "boolean" || !Number.isSafeInteger(result.latest_cursor) || result.latest_cursor < 0 || !Number.isSafeInteger(result.next_cursor)) throw Error("Invalid feed");
    let previous = after;
    for (const event of result.events) {
      if (!Number.isSafeInteger(event.id) || event.id <= previous || event.id > result.latest_cursor || typeof event.name !== "string" || !event.name.trim() || event.name.length > 80 || !Number.isSafeInteger(event.joined_at) || event.joined_at < 0 || ![0, 1].includes(event.online)) throw Error("Invalid join");
      previous = event.id;
    }
    if (result.events.length && result.next_cursor !== previous || result.has_more && !result.events.length) throw Error("Invalid cursor");
    return result;
  } // Bound transport time and payload size; refuse redirects, malformed identity fields and reordered join events.

  async function run() {
    const saved = state(), result = await page(saved?.cursor ?? 0);
    if (stopped) return;
    if (!saved || saved.stream !== result.stream) { advance(result.stream, result.latest_cursor); return; } // First enable or a replaced game database starts with future joins only.
    if (result.latest_cursor < saved.cursor || result.next_cursor < saved.cursor || result.next_cursor > result.latest_cursor) throw Error("Feed cursor reset");
    for (const event of result.events) {
      if (stopped) return;
      if (!event.online || now() - event.joined_at > 120000 || event.joined_at > now() + 30000) { advance(result.stream, event.id); continue; }
      const channel = await client.channels.fetch(config.channel);
      if (stopped) return;
      if (!channel?.guildId || !channel.isTextBased?.() || !channel.send || !channel.messages?.fetch) throw Error("Invalid destination");
      const roles = await channel.guild.roles.fetch();
      const matches = [...roles.values()].filter(role => role?.name?.trim().toLowerCase() === "lidollmmo");
      if (matches.length !== 1) throw Object.assign(Error("Role unavailable"), { onlineCode: "Create exactly one role named lidollmmo in the destination server." });
      const role = matches[0];
      if (!role.mentionable && !channel.permissionsFor(await channel.guild.members.fetchMe())?.has(PermissionFlagsBits.MentionEveryone)) throw Object.assign(Error("Role cannot be mentioned"), { onlineCode: "Make the lidollmmo role mentionable or grant MommyBot Mention Everyone permission in the destination channel." });
      const payload = joinMessage(result.stream, event, role.id);
      const attempted = db.prepare("SELECT 1 FROM online_attempts WHERE url=? AND channel=? AND stream=? AND event=?").get(config.url, config.channel, result.stream, event.id);
      if (attempted) {
        const recent = await channel.messages.fetch({ limit: 100, cache: false });
        if ([...recent.values()].some(message => message.author?.id === client.user.id && message.embeds?.some(embed => embed.footer?.text === payload.embeds[0].footer.text))) {
          advance(result.stream, event.id); continue;
        }
      } // Find a sent message whose receipt was lost before retrying with the same Discord nonce.
      if (stopped) return;
      db.prepare("INSERT OR IGNORE INTO online_attempts VALUES (?,?,?,?)").run(config.url, config.channel, result.stream, event.id);
      await channel.send(payload);
      advance(result.stream, event.id);
    }
    advance(result.stream, result.next_cursor);
  } // Skip offline/stale arrivals rather than announcing someone is online after an outage; read the next page on the next poll.
  function poll() {
    if (stopped) return Promise.resolve();
    return active ||= run().catch(error => logger.error(`[LiDollMMO] ${error.onlineCode || "Join feed or Discord delivery unavailable; retrying with saved progress."}`)).finally(() => { active = null; });
  }
  return {
    poll,
    start() { if (timer || stopped) return; void poll(); timer = setInterval(() => { void poll(); }, 10000); timer.unref(); },
    async stop() { stopped = true; clearInterval(timer); await active; db.close(); },
  }; // Start only after Discord is ready; coalesce polls and finish in-flight delivery before closing SQLite.
}
