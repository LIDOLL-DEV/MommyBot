import { createHash } from "node:crypto";
import { Events, PermissionFlagsBits as P } from "discord.js";
import { emojiKey, AdminError } from "./store.js";
import { selfServiceRole, textChannel } from "./access.js";

const keyOf = reaction => reaction.emoji.id || emojiKey(reaction.emoji.name);
const missing = error => [10003, 10008, 10007].includes(Number(error?.code));

export async function reactionUsers(reaction) {
  const users = new Map();
  if (!reaction) return users;
  let after;
  for (let page = 0; page < 100; page++) {
    const batch = await reaction.users.fetch({ limit: 100, ...(after ? { after } : {}), type: 0 });
    for (const user of batch.values()) users.set(user.id, user);
    if (batch.size < 100) return users;
    const next = [...batch.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1).at(-1);
    if (!next || next === after) throw new AdminError("Reaction pagination did not advance.");
    after = next;
  }
  throw new AdminError("This reaction exceeds the supported ten thousand members.");
} // Fetch normal reactions in full, rather than trusting an incomplete process-local reaction cache.

export function createCommunityFeatures(client, store, { logger = console } = {}) {
  const queues = new Map(), listeners = [];
  let stopped = false, timer, maintenance;
  const enqueue = (key, guild, work) => {
    if (stopped) return Promise.resolve();
    const pending = (queues.get(key) || Promise.resolve()).then(work).catch(error => {
      logger.error(`[Community] Action failed in guild ${guild}; check bot permissions and the admin activity log.`);
      store.audit(guild, "bot", "action.failed", `Discord operation could not complete (${Number.isInteger(error?.code) ? error.code : "unavailable"}). It will be retried when synchronized.`);
    }).finally(() => { if (queues.get(key) === pending) queues.delete(key); });
    queues.set(key, pending); return pending;
  }; // Serialize changes to a message or role binding, isolate Discord errors, and drain all work at shutdown.

  async function memberRole(binding, userId, present) {
    if (!store.binding(binding.id)) return;
    const guild = client.guilds.cache.get(binding.guild_id);
    if (!guild) return;
    const role = await guild.roles.fetch(binding.role_id), bot = await guild.members.fetchMe();
    if (!selfServiceRole(role, guild, bot)) throw new AdminError("Reaction role is no longer safe or manageable.");
    let member;
    try { member = await guild.members.fetch({ user: userId, force: true }); }
    catch (error) { if (!missing(error)) throw error; }
    const previous = store.db.prepare("SELECT * FROM reaction_role_grants WHERE binding_id=? AND user_id=?").get(binding.id, userId);
    if (!member || member.user.bot) {
      store.db.prepare("DELETE FROM reaction_role_grants WHERE binding_id=? AND user_id=?").run(binding.id, userId); return;
    }
    if (!store.binding(binding.id)) return; // An administrator may remove the mapping while Discord membership is loading.
    if (present) {
      const owned = previous?.owned ?? Number(!member.roles.cache.has(role.id));
      store.db.prepare("INSERT OR REPLACE INTO reaction_role_grants VALUES (?,?,?)").run(binding.id, userId, owned);
      if (!member.roles.cache.has(role.id)) await member.roles.add(role, "MommyBot reaction role");
    } else {
      if (previous?.owned && member.roles.cache.has(role.id)) await member.roles.remove(role, "MommyBot reaction removed");
      store.db.prepare("DELETE FROM reaction_role_grants WHERE binding_id=? AND user_id=?").run(binding.id, userId);
    }
  } // Journal bot-owned grants before Discord changes; never remove a role that predated this reaction mapping.

  async function syncBindingNow(binding) {
    if (!store.binding(binding.id)) return;
    const guild = client.guilds.cache.get(binding.guild_id); if (!guild) return;
    let message;
    try { const channel = await textChannel(guild, binding.channel_id); message = await channel.messages.fetch({ message: binding.message_id, force: true }); }
    catch (error) { if (!missing(error)) throw error; }
    const reaction = message?.reactions.cache.find(item => keyOf(item) === binding.emoji);
    const users = await reactionUsers(reaction);
    for (const user of users.values()) { if (stopped) return; if (!user.bot) await memberRole(binding, user.id, true); }
    for (const grant of store.db.prepare("SELECT user_id FROM reaction_role_grants WHERE binding_id=?").all(binding.id)) {
      if (stopped) return;
      if (!users.has(grant.user_id)) await memberRole(binding, grant.user_id, false);
    }
  } // Reconcile offline reaction changes and reaction clears against the durable ownership journal.

  const syncBinding = binding => enqueue(`role:${binding.id}`, binding.guild_id, () => syncBindingNow(binding));

  async function removePost(row) {
    try {
      const channel = await client.channels.fetch(row.channel_id);
      if (channel?.guildId !== row.guild_id) throw new AdminError("Starboard channel unavailable.");
      await channel.messages.delete(row.post_id);
    } catch (error) { if (!missing(error)) throw error; }
    store.db.prepare("DELETE FROM starboard_posts WHERE guild_id=? AND source_id=?").run(row.guild_id, row.source_id);
  } // Delete only a saved bot-owned highlight; source messages are never edited or deleted.

  async function syncStarNow(guildId, channelId, messageId) {
    const settings = store.settings(guildId).starboard;
    const saved = store.db.prepare("SELECT * FROM starboard_posts WHERE guild_id=? AND source_id=?").get(guildId, messageId);
    if (!settings.enabled || !settings.sources.includes(channelId) || channelId === settings.channel) {
      if (saved) await removePost(saved); return;
    }
    const guild = client.guilds.cache.get(guildId); if (!guild) return;
    let message, source;
    try { source = await textChannel(guild, channelId); message = await source.messages.fetch({ message: messageId, force: true }); }
    catch (error) { if (!missing(error)) throw error; if (saved) await removePost(saved); return; }
    const target = await textChannel(guild, settings.channel, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]);
    if (message.author?.bot || !source.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel) || source.nsfw && !target.nsfw) {
      if (saved) await removePost(saved); return;
    } // Public source channels only; never copy restricted or age-restricted content to a broader audience.
    const reaction = message.reactions.cache.find(item => keyOf(item) === settings.emoji);
    const voters = [...(await reactionUsers(reaction)).values()].filter(user => !user.bot && user.id !== message.author.id);
    if (voters.length < settings.threshold) { if (saved) await removePost(saved); return; }
    const url = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
    const attachment = [...message.attachments.values()].find(file => !file.spoiler && /^image\/(png|jpeg|gif|webp)$/.test(file.contentType || ""));
    const embed = { color: 0xf3b9d1, author: { name: String(message.author.globalName || message.author.username || "Member").slice(0, 256) },
      description: String(message.content || "(Attachment or embed)").slice(0, 3500),
      fields: [{ name: "Original message", value: `[Jump to message](${url})` }], footer: { text: `Source ${messageId}` },
      ...(attachment ? { image: { url: attachment.url } } : {}) };
    const marker = /^\d+$/.test(settings.emoji) ? `<:star:${settings.emoji}>` : settings.emoji;
    const content = `${marker} **${voters.length}** · <#${channelId}>`;
    const payload = { content, embeds: [embed], allowedMentions: { parse: [] } };
    if (saved && saved.channel_id !== target.id) await removePost(saved);
    if (saved && saved.channel_id === target.id) {
      try { await target.messages.edit(saved.post_id, payload); return; }
      catch (error) { if (!missing(error)) throw error; }
    }
    const post = await target.send({ ...payload, nonce: createHash("sha256").update(`star:${guildId}:${messageId}:${target.id}`).digest("hex").slice(0, 24), enforceNonce: true });
    store.db.prepare("INSERT OR REPLACE INTO starboard_posts VALUES (?,?,?,?,?)").run(guildId, messageId, channelId, target.id, post.id);
  } // Recount real voters, exclude self-stars and bots, and edit one highlight instead of creating duplicates.

  const syncStar = (guild, channel, message) => {
    if (stopped) return Promise.resolve();
    store.db.prepare("INSERT OR REPLACE INTO starboard_pending VALUES (?,?,?)").run(guild, message, channel);
    return enqueue(`star:${guild}:${message}`, guild, async () => {
      store.db.prepare("INSERT OR REPLACE INTO starboard_pending VALUES (?,?,?)").run(guild, message, channel); // An earlier queued success may have cleared this key before this attempt started.
      await syncStarNow(guild, channel, message);
      store.db.prepare("DELETE FROM starboard_pending WHERE guild_id=? AND source_id=?").run(guild, message);
    });
  }; // Save first-publication attempts too, so a failed send retries after restart even without another reaction.
  function handleReaction(reaction, user, details = {}) {
    const message = reaction.message, guild = message.guildId;
    if (stopped || !guild || user?.bot || details.type === 1) return Promise.resolve();
    const work = [];
    for (const binding of store.bindings(guild)) {
      if (binding.channel_id === message.channelId && binding.message_id === message.id && binding.emoji === keyOf(reaction)) work.push(syncBinding(binding));
    }
    const board = store.settings(guild).starboard;
    if (board.enabled && board.sources.includes(message.channelId) && keyOf(reaction) === board.emoji) work.push(syncStar(guild, message.channelId, message.id));
    return Promise.all(work);
  } // Partial events still contain IDs; synchronization fetches complete messages and current member roles.
  function handleMessageChange(message) {
    if (!message.guildId || stopped) return Promise.resolve();
    const work = store.bindings(message.guildId).filter(row => row.message_id === message.id).map(syncBinding);
    if (store.db.prepare("SELECT 1 FROM starboard_posts WHERE guild_id=? AND source_id=?").get(message.guildId, message.id)) work.push(syncStar(message.guildId, message.channelId, message.id));
    return Promise.all(work);
  } // Message deletion, edits and reaction clears refresh tracked highlights and role grants.
  async function reconcile() {
    for (const binding of store.db.prepare("SELECT * FROM reaction_roles").all()) { if (stopped) return; await syncBinding(binding); }
    for (const row of store.db.prepare("SELECT guild_id,source_id,source_channel FROM starboard_posts UNION SELECT guild_id,source_id,source_channel FROM starboard_pending").all()) { if (stopped) return; await syncStar(row.guild_id, row.source_channel, row.source_id); }
  }
  const tick = () => maintenance ||= reconcile().finally(() => { maintenance = null; });
  const on = (event, handler) => { client.on(event, handler); listeners.push([event, handler]); };
  return {
    store, handleReaction, handleMessageChange, syncBinding, syncStar, tick,
    enabled(guild, feature) { return store.settings(guild)[feature] !== false; },
    start() {
      if (timer || stopped) return;
      const safe = handler => (...args) => { void Promise.resolve().then(() => handler(...args)).catch(() => logger.error("[Community] Event processing failed; synchronization will retry.")); };
      on(Events.MessageReactionAdd, safe(handleReaction)); on(Events.MessageReactionRemove, safe(handleReaction));
      on(Events.MessageReactionRemoveAll, safe(handleMessageChange)); on(Events.MessageReactionRemoveEmoji, safe(reaction => handleMessageChange(reaction.message)));
      on(Events.MessageDelete, safe(handleMessageChange)); on(Events.MessageUpdate, safe((_old, message) => handleMessageChange(message)));
      on(Events.MessageDeleteBulk, safe(messages => Promise.all([...messages.values()].map(handleMessageChange))));
      timer = setInterval(() => void tick().catch(() => logger.error("[Community] Synchronization will retry.")), 300_000); timer.unref();
      void tick().catch(() => logger.error("[Community] Startup synchronization will retry."));
    },
    async stop() { stopped = true; clearInterval(timer); for (const [event, handler] of listeners) client.off(event, handler); await maintenance; await Promise.allSettled([...queues.values()]); },
  };
} // One runtime serves every guild with isolated configuration; normal reactions are synchronized on events and every five minutes.
