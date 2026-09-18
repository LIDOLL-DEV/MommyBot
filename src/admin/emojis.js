import { AdminError, emojiKey } from "./store.js";

export function guildEmojiResolver(guild) {
  let serverEmojis;
  return async value => {
    const text = String(value ?? "").trim();
    const name = /^:([A-Za-z0-9_]{2,32}):$/.exec(text)?.[1];
    if (name) {
      serverEmojis ||= guild.emojis.fetch(); // Fetch once per admin request, so every choice uses the same server emoji list.
      let emojis;
      try { emojis = await serverEmojis; }
      catch { throw new AdminError("Could not load this server's custom emojis. Try again shortly."); }
      const matches = [...emojis.values()].filter(emoji => emoji.name === name);
      if (!matches.length) throw new AdminError(`No custom emoji named :${name}: exists in this server. For a standard emoji, paste the actual symbol instead.`);
      if (matches.length > 1) throw new AdminError(`More than one server emoji is named :${name}:. Paste its full <:name:id> code or emoji ID instead.`);
      return matches[0].id;
    }
    const key = emojiKey(text);
    if (/^\d+$/.test(key) && !await guild.emojis.fetch(key).catch(() => null)) throw new AdminError("Choose a custom emoji from this server.");
    return key;
  };
} // Resolve server :names:, full custom emoji codes and Unicode to stable keys before saving or comparing choices.
