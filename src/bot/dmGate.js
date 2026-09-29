const NOTICE_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * Decide whether Sakura may chat with the author of a direct message.
 * DMs are open to members of any server where chat is enabled, unless DM_CHAT_ENABLED=false turns them off.
 */
export function createDmGate({ client, chatEnabled, env = process.env, now = Date.now, logger = console }) {
  const noticed = new Map(); // userId -> last decline time, so a refused member is told once a day instead of on every message.

  async function isMember(guild, userId) {
    if (guild.members.cache.has(userId)) return true;
    try { return Boolean(await guild.members.fetch(userId)); }
    catch { return false; } // Unknown Member (or a missing permission) simply means "not a member here".
  }

  async function sharesChatServer(userId) {
    for (const guild of client.guilds.cache.values()) {
      if (chatEnabled(guild.id) && await isMember(guild, userId)) return true;
    }
    return false;
  }

  async function decline(message, text) {
    const last = noticed.get(message.author.id);
    if (last !== undefined && now() - last < NOTICE_INTERVAL_MS) return;
    noticed.set(message.author.id, now());
    try { await message.channel.send(text); }
    catch { logger.error("[Chat] Could not deliver the DM notice."); }
  }

  return async function allowDirectMessage(message) {
    if (env.DM_CHAT_ENABLED === "false") {
      await decline(message, "Sakura isn't chatting in DMs right now. Come say hi in the server instead!");
      return false;
    }
    if (await sharesChatServer(message.author.id)) return true;
    await decline(message, "Sakura only chats in DMs with members of a server where she's allowed to chat. Join one and come back!");
    return false;
  };
} // DMs skip each server's channel gate and chat switch, so membership in a chat-enabled server stands in for both.
