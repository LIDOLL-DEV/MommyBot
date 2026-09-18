import { PermissionFlagsBits as P, ChannelType } from "discord.js";
import { AdminError, discordId } from "./store.js";

const privileged = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageWebhooks,
  P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages, P.MentionEveryone, P.ViewAuditLog, P.ManageEvents, P.ManageThreads];

export function selfServiceRole(role, guild, bot, actor = null) {
  return Boolean(role && role.id !== guild.id && !role.managed && !privileged.some(flag => role.permissions.has(flag)) &&
    bot.permissions.has(P.ManageRoles) && bot.roles.highest.comparePositionTo(role) > 0 &&
    (!actor || actor.id === guild.ownerId || actor.roles.highest.comparePositionTo(role) > 0));
} // Never offer managed, privileged, everyone or hierarchy-blocked roles as self-service rewards.

export async function textChannel(guild, id, permissions = [P.ViewChannel, P.ReadMessageHistory]) {
  discordId(id);
  const channel = await guild.channels.fetch(id);
  if (!channel) throw Object.assign(new AdminError("Channel no longer exists.", 404), { code: 10003 });
  const bot = await guild.members.fetchMe();
  if (!channel || channel.guildId !== guild.id || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) ||
    !channel.permissionsFor(bot)?.has(permissions)) throw new AdminError("Choose a text channel this bot can access with the required permissions.");
  return channel;
} // Resolve channels through the selected guild; a browser cannot supply another server's channel.

export function createAdminAccess(client, identities) {
  const linked = session => {
    const identity = identities.gameIdentity(session.user_id);
    const link = identity && identities.find(identity.issuer, identity.subject);
    if (!link) throw new AdminError("Link this LiD0llID to Discord with /lidollid login and confirm it first.", 403);
    return link;
  };
  return {
    async require(session, guildId) {
      const link = linked(session), guild = client.guilds.cache.get(discordId(guildId));
      if (!guild) throw new AdminError("You cannot administer this server.", 403);
      const member = await guild.members.fetch({ user: link.discord_id, force: true }).catch(() => null);
      if (!member || member.user.bot || !member.permissions.has(P.Administrator)) throw new AdminError("Discord Administrator permission is required for this server.", 403);
      const current = linked(session);
      if (current.discord_id !== link.discord_id || current.linked_at !== link.linked_at) throw new AdminError("Your account link changed. Sign in again.", 403);
      return { guild, member, actor: link.discord_id };
    },
    async list(session) {
      linked(session);
      const result = [];
      for (const guild of client.guilds.cache.values()) {
        try { await this.require(session, guild.id); result.push({ id: guild.id, name: guild.name }); }
        catch (error) { if (!(error instanceof AdminError) || error.status !== 403) throw error; }
      }
      return result;
    },
  };
} // Recheck verified account links and live Administrator permission on every server read or mutation.
