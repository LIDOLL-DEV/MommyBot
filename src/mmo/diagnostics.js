import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { PermissionFlagsBits as P, PermissionsBitField } from "discord.js";
import { onlineConfig } from "./online.js";
import { onlinePage, onlineFailure, OnlineError } from "./feed.js";

export function channelPermissions(channel, roles, member, userId, guildId) {
  let permissions = roles.filter(role => role.id === guildId || member.roles.includes(role.id))
    .reduce((bits, role) => bits | BigInt(role.permissions), 0n);
  if (permissions & P.Administrator) return new PermissionsBitField(PermissionsBitField.All);
  const overwrites = channel.permission_overwrites || [];
  const apply = overwrite => { if (overwrite) permissions = permissions & ~BigInt(overwrite.deny) | BigInt(overwrite.allow); };
  apply(overwrites.find(row => row.id === guildId));
  let allow = 0n, deny = 0n;
  for (const row of overwrites.filter(row => row.type === 0 && row.id !== guildId && member.roles.includes(row.id))) { allow |= BigInt(row.allow); deny |= BigInt(row.deny); }
  permissions = permissions & ~deny | allow;
  apply(overwrites.find(row => row.type === 1 && row.id === userId));
  return new PermissionsBitField(permissions);
} // Calculate the bot's channel-effective permissions, including everyone, combined role and member overwrites.

async function discordCheck(config, token, fetcher) {
  if (!token) throw new OnlineError("discord_token_missing", "Set DISCORD_TOKEN in the bot's environment file.");
  async function get(path) {
    const response = await fetcher(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${token}` }, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new OnlineError(`discord_http_${response.status}`, response.status === 401 ? "Discord rejected DISCORD_TOKEN." : "MommyBot cannot read the destination server/channel. Check channel ID, server membership and permissions.");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 1048576) throw new OnlineError("discord_response_invalid", "Discord response exceeded the diagnostic limit."); chunks.push(Buffer.from(chunk)); }
    return JSON.parse(Buffer.concat(chunks));
  }
  const channel = await get(`/channels/${config.channel}`);
  if (!/^\d{17,20}$/.test(channel.guild_id || "") || ![0, 5].includes(channel.type)) throw new OnlineError("discord_channel_invalid", "The destination must be a server text or announcement channel.");
  const [roles, bot] = await Promise.all([get(`/guilds/${channel.guild_id}/roles`), get("/users/@me")]);
  if (!/^\d{17,20}$/.test(bot.id || "") || !Array.isArray(roles)) throw new OnlineError("discord_response_invalid", "Discord returned unexpected role/user data.");
  const member = await get(`/guilds/${channel.guild_id}/members/${bot.id}`);
  const permissions = channelPermissions(channel, roles, member, bot.id, channel.guild_id);
  const missing = ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"].filter(name => !permissions.has(P[name]));
  const matches = roles.filter(role => role.name?.trim().toLowerCase() === "lidollmmo");
  const canPing = matches.length === 1 && (matches[0].mentionable || permissions.has(P.MentionEveryone));
  return { ok: !missing.length && canPing, channelId: config.channel, missingPermissions: missing, matchingRoles: matches.length, canPingRole: Boolean(canPing),
    detail: missing.length ? `Grant ${missing.join(", ")} in #whos-online.` : matches.length !== 1 ? "Create exactly one role named lidollmmo." : !canPing ? "Make lidollmmo mentionable or grant Mention Everyone in #whos-online." : "Channel permissions and lidollmmo role tag are ready. No message was sent." };
} // Read-only Discord REST calls validate access without a gateway connection, test post or role mention.

export async function inspectOnline(env, { fetcher = fetch, now = Date.now, filename } = {}) {
  const checks = [{ check: "enabled", ok: env.LIDOLLMMO_ONLINE_ENABLED === "true", detail: env.LIDOLLMMO_ONLINE_ENABLED === "true" ? "Announcement feature is enabled in these settings." : "Set LIDOLLMMO_ONLINE_ENABLED=true and restart MommyBot." }];
  let config;
  try { config = onlineConfig({ ...env, LIDOLLMMO_ONLINE_ENABLED: "true" }); }
  catch { checks.push({ check: "configuration", ok: false, detail: "Set a valid LIDOLLMMO_ONLINE_URL, MOMMYBOT_ONLINE_TOKEN (32-128 URL-safe characters) and channel ID." }); return { ok: false, checks }; }
  let saved;
  const path = filename || config.filename;
  if (!existsSync(path)) checks.push({ check: "saved_progress", ok: true, initialized: false, detail: "No delivery database yet. The first successful poll skips history; join after the bot connects." });
  else {
    let db;
    try {
      db = new Database(path, { readonly: true, fileMustExist: true });
      saved = db.prepare("SELECT stream,cursor FROM online_feeds WHERE url=? AND channel=?").get(config.url, config.channel);
      const attempts = db.prepare("SELECT COUNT(*) AS n FROM online_attempts WHERE url=? AND channel=?").get(config.url, config.channel).n;
      checks.push({ check: "saved_progress", ok: true, initialized: Boolean(saved), cursor: saved?.cursor ?? null, pendingAttempts: attempts, detail: saved ? "Saved progress loaded read-only." : "No baseline for this URL/channel yet. Wait for the bot's first successful poll before joining." });
    } catch { checks.push({ check: "saved_progress", ok: false, detail: "Cannot read data/mmo-online.db. Run as the mommybot user from the active release; check storage permissions/schema." }); }
    finally { db?.close(); }
  }
  const [feed, discord] = await Promise.all([
    (async () => {
      try {
        const page = await onlinePage(config, saved?.cursor ?? 0, fetcher);
        const recent = await onlinePage(config, Math.max(0, page.latest_cursor - 20), fetcher);
        const newest = recent.events.at(-1), changed = Boolean(saved && saved.stream !== page.stream);
        return { check: "join_feed", ok: true, latestCursor: page.latest_cursor, unreadEvents: changed ? null : Math.max(0, page.latest_cursor - (saved?.cursor ?? page.latest_cursor)),
          sourceChanged: changed, newestEventAgeSeconds: newest ? Math.floor((now() - newest.joined_at) / 1000) : null, newestEventOnline: newest ? Boolean(newest.online) : null,
          detail: !page.latest_cursor ? "Authenticated feed works but has no arrivals. Enter the shared MMO world with a signed-in account." : "Authenticated feed works. Joins older than two minutes or already offline are skipped; reconnects within two minutes do not create a new event." };
      } catch (error) { return { check: "join_feed", ok: false, detail: onlineFailure(error) }; }
    })(),
    discordCheck(config, env.DISCORD_TOKEN, fetcher).then(result => ({ check: "discord", ...result }), error => ({ check: "discord", ok: false, detail: onlineFailure(error, "discord") })),
  ]);
  checks.push(feed, discord);
  return { ok: checks.every(check => check.ok), checks };
} // Report only configuration/access state, event counts and ages; omit names, tokens and remote bodies and never advance cursors.
