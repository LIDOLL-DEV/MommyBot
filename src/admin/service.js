import { PermissionFlagsBits as P, ChannelType } from "discord.js";
import { AdminError, discordId, swearWordList } from "./store.js";
import { selfServiceRole, textChannel } from "./access.js";
import { guildEmojiResolver } from "./emojis.js";

export function createAdminService(client, store, access, community, env = process.env) {
  return {
    async state(session, guildId) {
      if (!guildId) return { guilds: await access.list(session), username: session.username, csrf: session.csrf };
      const { guild, member } = await access.require(session, guildId);
      const [channels, roles, bot] = await Promise.all([guild.channels.fetch(), guild.roles.fetch(), guild.members.fetchMe()]);
      const audiences = [...roles.values()].filter(role => role.id !== guild.id);
      return {
        guild: { id: guild.id, name: guild.name }, settings: store.settings(guild.id), bindings: store.bindings(guild.id), audit: store.history(guild.id),
        channels: [...channels.values()].filter(channel => channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) && channel.permissionsFor(bot)?.has([P.ViewChannel, P.ReadMessageHistory]))
          .map(channel => ({ id: channel.id, name: channel.name, public: Boolean(channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)), nsfw: Boolean(channel.nsfw),
            viewers: audiences.filter(role => channel.permissionsFor(role)?.has(P.ViewChannel)).map(role => role.id) })),
        roles: [...roles.values()].filter(role => selfServiceRole(role, guild, bot, member)).map(role => ({ id: role.id, name: role.name })),
        readableRoles: audiences.map(role => ({ id: role.id, name: role.name })),
        // Membership and channel visibility are only read for diaper checks and the starboard audience, so any role may be named there.
        status: { connected: client.isReady(), ping: Math.max(0, Math.round(client.ws.ping)),
          swearJarAvailable: env.LIDOLLID_ENABLED === "true" && env.LIDOLLCOIN_ENABLED === "true" && env.SWEAR_JAR_ENABLED !== "false",
          welcomesAvailable: env.WELCOME_ENABLED !== "false", chatChannel: env.CHANNEL_ID || "All channels" },
      };
    },
    async act(session, input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new AdminError("Invalid admin request.");
      const { guild, member } = await access.require(session, input.guild);
      const resolveEmoji = guildEmojiResolver(guild);
      if (input.action === "settings") {
        if ([input.chat, input.swearJar, input.welcomes].some(value => typeof value !== "boolean")) throw new AdminError("Choose on or off for each bot control.");
        const board = input.starboard;
        if (!board || typeof board.enabled !== "boolean" || !Number.isInteger(board.threshold) || board.threshold < 1 || board.threshold > 100 || !Array.isArray(board.sources) || board.sources.length > 50) throw new AdminError("Choose a star threshold from one to one hundred and at most fifty source channels.");
        const ignored = input.swearJarIgnored ?? []; // Older clients that never send the list keep the swear jar watching every channel.
        if (!Array.isArray(ignored) || ignored.length > 100) throw new AdminError("Choose at most one hundred ignored swear-jar channels.");
        const swearJarIgnored = [...new Set(ignored.map(discordId))];
        const swearWords = swearWordList(input.swearWords); // An omitted or empty list keeps the deployment's own word list.
        const checks = input.diaperChecks ?? { enabled: false, channel: "", role: "" }; // Older clients that never send the block leave diaper checks off.
        if (!checks || typeof checks !== "object" || Array.isArray(checks) || typeof checks.enabled !== "boolean") throw new AdminError("Choose on or off for diaper checks.");
        const diaperChecks = { enabled: checks.enabled, channel: checks.channel ? discordId(checks.channel) : "", role: checks.role ? discordId(checks.role) : "" };
        if (diaperChecks.enabled) {
          if (!diaperChecks.channel) throw new AdminError("Choose a channel for diaper checks.");
          const target = await textChannel(guild, diaperChecks.channel, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages]);
          if (target.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) throw new AdminError("Choose a diaper check channel that is not visible to @everyone; these questions are personal.");
          if (!diaperChecks.role) throw new AdminError("Choose the role whose members take part in diaper checks.");
          const role = await guild.roles.fetch(diaperChecks.role);
          if (!role || role.id === guild.id) throw new AdminError("Choose a real role for diaper checks.");
        } // Require an explicit opt-in role and a non-public channel before MommyBot asks anyone about accidents.
        const show = input.showcase ?? { enabled: false, channel: "" }; // Older clients that never send the block leave the showcase off.
        if (!show || typeof show !== "object" || Array.isArray(show) || typeof show.enabled !== "boolean") throw new AdminError("Choose on or off for the character showcase.");
        const showcase = { enabled: show.enabled, channel: show.channel ? discordId(show.channel) : "" };
        if (showcase.enabled) {
          if (!showcase.channel) throw new AdminError("Choose a channel for the LiDollQuest character showcase.");
          await textChannel(guild, showcase.channel, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles]);
        } // Character sheets carry an image, so the showcase channel needs Embed Links and Attach Files.
        const normalized = { enabled: board.enabled, channel: board.channel || "", threshold: board.threshold, emoji: await resolveEmoji(board.emoji),
          audience: board.audience ? discordId(board.audience) : "", sources: [...new Set(board.sources.map(discordId))] };
        if (normalized.enabled || normalized.channel) {
          const target = await textChannel(guild, normalized.channel, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks]);
          if (normalized.enabled && !normalized.sources.length) throw new AdminError("Choose at least one source channel the audience can see.");
          let audience = null;
          if (normalized.audience) {
            audience = await guild.roles.fetch(normalized.audience);
            if (!audience || audience.id === guild.id) throw new AdminError("Choose a real audience role for the starboard, or leave it open to @everyone.");
            if (target.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) throw new AdminError("A role-restricted starboard must not be visible to @everyone, or its highlights would reach a wider audience than their source.");
            if (!target.permissionsFor(audience)?.has(P.ViewChannel)) throw new AdminError("The starboard channel must be visible to the audience role.");
          } // A narrower audience is always safe; the starboard may never be seen by more people than a source channel.
          for (const id of normalized.sources) {
            const source = await textChannel(guild, id);
            if (id === target.id) throw new AdminError("The starboard cannot also be a source channel.");
            if (!source.permissionsFor(audience ?? guild.roles.everyone)?.has(P.ViewChannel)) {
              throw new AdminError(audience ? "Starboard source channels must be visible to the audience role." : "Starboard source channels must be visible to @everyone.");
            }
            if (source.nsfw && !target.nsfw) throw new AdminError("Age-restricted source channels need an age-restricted starboard.");
          }
        }
        const { actor } = await access.require(session, guild.id);
        store.save(guild.id, { chat: input.chat, swearJar: input.swearJar, swearJarIgnored, swearWords, welcomes: input.welcomes, diaperChecks, showcase, starboard: normalized }, actor);
        return { ok: true, message: "Settings saved. Existing highlights refresh during synchronization; new reactions use these settings now." };
      }
      if (input.action === "reaction-add") {
        const channel = await textChannel(guild, input.channel, [P.ViewChannel, P.ReadMessageHistory, P.AddReactions]);
        const selected = input.choices ?? [{ role: input.role, emoji: input.emoji }]; // Older clients can still save one choice.
        if (!Array.isArray(selected) || !selected.length || selected.length > 20) throw new AdminError("Add between one and twenty emoji/role choices.");
        const choices = await Promise.all(selected.map(async choice => {
          if (!choice || typeof choice !== "object" || Array.isArray(choice)) throw new AdminError("Choose an emoji and role for every row.");
          return { role: discordId(choice.role), emoji: await resolveEmoji(choice.emoji) };
        }));
        if (new Set(choices.map(choice => choice.role)).size !== choices.length || new Set(choices.map(choice => choice.emoji)).size !== choices.length) throw new AdminError("Use a different emoji and role for each choice.");
        const roles = await Promise.all(choices.map(choice => guild.roles.fetch(choice.role))), bot = await guild.members.fetchMe();
        if (roles.some(role => !selfServiceRole(role, guild, bot, member))) throw new AdminError("Choose non-privileged roles below both your role and the bot's role.");
        const message = await channel.messages.fetch(discordId(input.message)).catch(() => null);
        if (!message || message.guildId !== guild.id) throw new AdminError("Message not found in the selected channel.");
        const { actor, member: current } = await access.require(session, guild.id);
        const currentBot = await guild.members.fetchMe();
        if (roles.some(role => !selfServiceRole(role, guild, currentBot, current))) throw new AdminError("Role permissions changed. Refresh and try again.");
        const bindings = store.addBindings(guild.id, { channel: channel.id, message: message.id, choices }, actor);
        for (const { emoji } of choices) {
          try { await message.react(emoji); }
          catch { store.audit(guild.id, actor, "reaction.seed-failed", `Mapping saved, but emoji ${emoji} could not be added. Check Add Reactions permission and add the emoji manually.`); }
        }
        for (const binding of bindings) await community.syncBinding(binding);
        return { ok: true, message: `${bindings.length} reaction-role mapping${bindings.length === 1 ? "" : "s"} saved. Removing a reaction removes roles granted by these mappings. Check the activity log for synchronization errors.` };
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
