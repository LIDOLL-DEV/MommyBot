import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { escapeMarkdown, PermissionFlagsBits } from "discord.js";
import { onlinePage, onlineFailure, OnlineError } from "./feed.js";

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
  return { content: roleId ? `<@&${roleId}>` : undefined, embeds: [{ color: 0xd58cdb, title: "Someone’s here! 🌸", description: `**${name}** just joined **LiDollMMO**. Come say hello!\n\n[Play LiDollMMO](https://lidoll.dev/)`,
    footer: { text: `LiDollMMO join · ${marker}` } }],
    allowedMentions: { parse: [], users: [], roles: roleId ? [roleId] : [] }, nonce: marker.slice(0, 24), enforceNonce: true };
} // Only the explicitly resolved lidollmmo role may ping; character names cannot mention other users or roles.

export function createOnlinePublisher(client, { env = process.env, config, fetcher = fetch, now = Date.now, logger = console } = {}) {
  try { if (config === undefined) config = onlineConfig(env); }
  catch { logger.error("[LiDollMMO] Announcements disabled: check LIDOLLMMO_ONLINE_URL, MOMMYBOT_ONLINE_TOKEN and channel ID."); return null; }
  if (!config) { logger.log?.("[LiDollMMO] Announcements OFF: set LIDOLLMMO_ONLINE_ENABLED=true and configure the feed URL and shared token."); return null; }
  if (config.filename !== ":memory:") mkdirSync(dirname(config.filename), { recursive: true });
  const db = new Database(config.filename); db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS online_feeds(url TEXT NOT NULL,channel TEXT NOT NULL,stream TEXT NOT NULL,cursor INTEGER NOT NULL,PRIMARY KEY(url,channel));
    CREATE TABLE IF NOT EXISTS online_attempts(url TEXT NOT NULL,channel TEXT NOT NULL,stream TEXT NOT NULL,event INTEGER NOT NULL,PRIMARY KEY(url,channel,stream,event));`);
  let stopped = false, active, timer, stage = "feed";
  const state = () => db.prepare("SELECT * FROM online_feeds WHERE url=? AND channel=?").get(config.url, config.channel);
  const advance = (stream, cursor) => db.transaction(() => {
    db.prepare("INSERT INTO online_feeds VALUES (?,?,?,?) ON CONFLICT(url,channel) DO UPDATE SET stream=excluded.stream,cursor=excluded.cursor").run(config.url, config.channel, stream, cursor);
    db.prepare("DELETE FROM online_attempts WHERE url=? AND channel=? AND (stream<>? OR event<=?)").run(config.url, config.channel, stream, cursor);
  })(); // Commit cursors and clear attempts together so completed joins survive bot restarts.

  async function run() {
    stage = "feed";
    const saved = state(), result = await onlinePage(config, saved?.cursor ?? 0, fetcher);
    if (stopped) return;
    if (!saved || saved.stream !== result.stream) {
      advance(result.stream, result.latest_cursor);
      logger.log?.(`[LiDollMMO] Feed connected; future-only baseline at event ${result.latest_cursor}. Join after this point; brief reconnects within two minutes are suppressed.`);
      return;
    } // First enable or a replaced game database starts with future joins only.
    if (result.latest_cursor < saved.cursor || result.next_cursor < saved.cursor || result.next_cursor > result.latest_cursor) throw Error("Feed cursor reset");
    for (const event of result.events) {
      if (stopped) return;
      if (!event.online || now() - event.joined_at > 120000 || event.joined_at > now() + 30000) {
        logger.log?.(`[LiDollMMO] Skipped event ${event.id}: ${!event.online ? "player_offline" : event.joined_at > now() + 30000 ? "game_clock_ahead" : "event_older_than_two_minutes"}.`);
        advance(result.stream, event.id); continue;
      }
      stage = "discord_destination";
      const channel = await client.channels.fetch(config.channel);
      if (stopped) return;
      if (!channel?.guildId || !channel.isTextBased?.() || !channel.send || !channel.messages?.fetch) throw new OnlineError("discord_channel_invalid", "Choose a server text channel MommyBot can access.");
      const roles = await channel.guild.roles.fetch();
      const matches = [...roles.values()].filter(role => role?.name?.trim().toLowerCase() === "lidollmmo");
      if (matches.length !== 1) throw new OnlineError("discord_role_missing_or_ambiguous", "Create exactly one role named lidollmmo in the destination server.");
      const role = matches[0];
      if (!role.mentionable && !channel.permissionsFor(await channel.guild.members.fetchMe())?.has(PermissionFlagsBits.MentionEveryone)) throw new OnlineError("discord_role_not_mentionable", "Make the lidollmmo role mentionable or grant MommyBot Mention Everyone permission in the destination channel.");
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
      logger.log?.(`[LiDollMMO] Announced event ${event.id} in channel ${config.channel}.`);
    }
    advance(result.stream, result.next_cursor);
  } // Skip offline/stale arrivals rather than announcing someone is online after an outage; read the next page on the next poll.
  function poll() {
    if (stopped) return Promise.resolve();
    return active ||= run().catch(error => logger.error(`[LiDollMMO] ${onlineFailure(error, stage)} Saved progress retained for retry.`)).finally(() => { active = null; });
  }
  return {
    poll,
    start() { if (timer || stopped) return; logger.log?.(`[LiDollMMO] Announcements ON: polling every ten seconds for channel ${config.channel}.`); void poll(); timer = setInterval(() => { void poll(); }, 10000); timer.unref(); },
    async stop() { stopped = true; clearInterval(timer); await active; db.close(); },
  }; // Start only after Discord is ready; coalesce polls and finish in-flight delivery before closing SQLite.
}
