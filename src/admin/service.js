import { PermissionFlagsBits as P, ChannelType } from "discord.js";
import { AdminError, discordId, emojiKey } from "./store.js";
import { selfServiceRole, textChannel } from "./access.js";

export function createAdminService(client, store, access, community, env = process.env) {
  return {
    async state(session, guildId) {
      if (!guildId) return { guilds: await access.list(session), username: session.username, csrf: session.csrf };
      const { guild, member } = await access.require(session, guildId);
      const [channels, roles, bot] = await Promise.all([guild.channels.fetch(), guild.roles.fetch(), guild.members.fetchMe()]);
      return {
        guild: { id: guild.id, name: guild.name }, settings: store.settings(guild.id), bindings: store.bindings(guild.id), audit: store.history(guild.id),
        channels: [...channels.values()].filter(channel => channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) && channel.permissionsFor(bot)?.has([P.ViewChannel, P.ReadMessageHistory]))
          .map(channel => ({ id: channel.id, name: channel.name, public: Boolean(channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)), nsfw: Boolean(channel.nsfw) })),
        roles: [...roles.values()].filter(role => selfServiceRole(role, guild, bot, member)).map(role => ({ id: role.id, name: role.name })),
        status: { connected: client.isReady(), ping: Math.max(0, Math.round(client.ws.ping)),
          swearJarAvailable: env.LIDOLLID_ENABLED === "true" && env.LIDOLLCOIN_ENABLED === "true" && env.SWEAR_JAR_ENABLED !== "false",
          welcomesAvailable: env.WELCOME_ENABLED !== "false", chatChannel: env.CHANNEL_ID || "All channels" },
      };
    },
    async act(session, input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new AdminError("Invalid admin request.");
      const { guild, member } = await access.require(session, input.guild);
      if (input.action === "settings") {
        if ([input.chat, input.swearJar, input.welcomes].some(value => typeof value !== "boolean")) throw new AdminError("Choose on or off for each bot control.");
        const board = input.starboard;
        if (!board || typeof board.enabled !== "boolean" || !Number.isInteger(board.threshold) || board.threshold < 1 || board.threshold > 100 || !Array.isArray(board.sources) || board.sources.length > 50) throw new AdminError("Choose a star threshold from one to one hundred and at most fifty source channels.");
        const normalized = { enabled: board.enabled, channel: board.channel || "", threshold: board.threshold, emoji: emojiKey(board.emoji), sources: [...new Set(board.sources.map(discordId))] };
        if (normalized.enabled || normalized.channel) {
          const target = await textChannel(guild, normalized.channel, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks]);
          if (normalized.enabled && !normalized.sources.length) throw new AdminError("Choose at least one public source channel.");
          for (const id of normalized.sources) {
            const source = await textChannel(guild, id);
            if (id === target.id) throw new AdminError("The starboard cannot also be a source channel.");
            if (!source.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) throw new AdminError("Starboard source channels must be visible to @everyone.");
            if (source.nsfw && !target.nsfw) throw new AdminError("Age-restricted source channels need an age-restricted starboard.");
          }
        }
        if (/^\d+$/.test(normalized.emoji) && !await guild.emojis.fetch(normalized.emoji).catch(() => null)) throw new AdminError("Choose a custom emoji from this server.");
        const { actor } = await access.require(session, guild.id);
        store.save(guild.id, { chat: input.chat, swearJar: input.swearJar, welcomes: input.welcomes, starboard: normalized }, actor);
        return { ok: true, message: "Settings saved. Existing highlights refresh during synchronization; new reactions use these settings now." };
      }
      if (input.action === "reaction-add") {
        const channel = await textChannel(guild, input.channel, [P.ViewChannel, P.ReadMessageHistory, P.AddReactions]);
        const role = await guild.roles.fetch(discordId(input.role)), bot = await guild.members.fetchMe();
        if (!selfServiceRole(role, guild, bot, member)) throw new AdminError("Choose a non-privileged role below both your role and the bot's role.");
        const message = await channel.messages.fetch(discordId(input.message)).catch(() => null);
        if (!message || message.guildId !== guild.id) throw new AdminError("Message not found in the selected channel.");
        const emoji = emojiKey(input.emoji);
        if (/^\d+$/.test(emoji) && !await guild.emojis.fetch(emoji).catch(() => null)) throw new AdminError("Choose a custom emoji from this server.");
        const { actor, member: current } = await access.require(session, guild.id);
        if (!selfServiceRole(role, guild, await guild.members.fetchMe(), current)) throw new AdminError("Role permissions changed. Refresh and try again.");
        const binding = store.addBinding(guild.id, { channel: channel.id, message: message.id, role: role.id, emoji }, actor);
        try { await message.react(emoji); }
        catch { store.audit(guild.id, actor, "reaction.seed-failed", "Mapping saved, but the emoji could not be added. Check Add Reactions permission and add the emoji manually."); }
        await community.syncBinding(binding);
        return { ok: true, message: "Reaction role saved. Removing a reaction removes roles granted by this mapping. Check the activity log for synchronization errors." };
      }
      if (input.action === "reaction-delete") {
        const binding = store.binding(String(input.id));
        if (!binding || binding.guild_id !== guild.id) throw new AdminError("Reaction-role mapping not found.", 404);
        const { actor } = await access.require(session, guild.id);
        store.deleteBinding(binding.id, actor);
        return { ok: true, message: "Mapping removed. Existing member roles and message reactions were retained." };
      }
      if (input.action === "sync") {
        await access.require(session, guild.id);
        for (const binding of store.bindings(guild.id)) await community.syncBinding(binding);
        for (const row of store.db.prepare("SELECT guild_id,source_id,source_channel FROM starboard_posts WHERE guild_id=? UNION SELECT guild_id,source_id,source_channel FROM starboard_pending WHERE guild_id=?").all(guild.id, guild.id)) await community.syncStar(guild.id, row.source_channel, row.source_id);
        return { ok: true, message: "Synchronization finished. Check the activity log for any permissions or Discord errors." };
      }
      throw new AdminError("Unknown admin action.");
    },
  };
} // Expose only scoped configuration actions; no shell execution, secret editing, wallet transfers or arbitrary Discord sends.
