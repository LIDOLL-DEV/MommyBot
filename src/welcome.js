import { createHash } from "node:crypto";
import { generateWelcomeMessage, welcomeProse } from "./graph/welcomeMessage.js";

export const WELCOME_CHANNEL_ID = "1548848205092094034";
export const RULES_CHANNEL_ID = "1477184919515041874";
export const RULES_MESSAGE_ID = "1548865939691405423";

export function createMemberWelcome(client, { env = process.env, generateMessage = generateWelcomeMessage, now = Date.now } = {}) {
  const enabled = env.WELCOME_ENABLED !== "false";
  const channelId = env.WELCOME_CHANNEL_ID || WELCOME_CHANNEL_ID;
  const rulesChannelId = env.WELCOME_RULES_CHANNEL_ID || RULES_CHANNEL_ID;
  const rulesMessageId = env.WELCOME_RULES_MESSAGE_ID || RULES_MESSAGE_ID;
  if (enabled && ![channelId, rulesChannelId, rulesMessageId].every(id => /^\d{17,20}$/.test(id))) throw new Error("Set valid Discord IDs for the welcome channel and rules message.");
  const active = new Map(), sent = new Map();
  let stopped = false;

  async function send(member, key) {
    const channel = await client.channels.fetch(channelId);
    if (stopped || !channel?.isTextBased() || typeof channel.send !== "function" || channel.guildId !== member.guild.id) return false;
    const prose = welcomeProse(await generateMessage({ env }).catch(() => null)) || "Welcome, sweet girl! We're so glad you're here. Let's help you get settled into your new little community. 🌸";
    if (stopped) return false;
    const rulesUrl = `https://discord.com/channels/${member.guild.id}/${rulesChannelId}/${rulesMessageId}`;
    const content = `<@${member.user.id}> ${prose}\n\n` +
      `📖 Please **read the server rules** here: ${rulesUrl}\n\n` +
      "🌷 To see the whole server, **complete your LiD0llID registration and link it to Discord**:\n" +
      "• Open **/menu → Connect / renew** (or run **/lidollid login**).\n" +
      "• Create a LiD0llID account if needed, sign in in your browser, and approve the connection.\n" +
      "• Return to Discord and choose **Enter sign-in code** in /menu, then paste the confirmation code from your browser. You can also use **/lidollid confirm code:YOUR_CODE**.\n\n" +
      "Finish that confirmation so the bot can give you the linked-account role for full server access. If you already linked but still need the role, try **/lidollid status**.";
    await channel.send({ content, allowedMentions: { parse: [], users: [member.user.id], repliedUser: false },
      nonce: createHash("sha256").update(key).digest("hex").slice(0, 24), enforceNonce: true });
    sent.set(key, now());
    while (sent.size > 5000) sent.delete(sent.keys().next().value);
    return true;
  } // Send only to the requested server/channel and ping only the newcomer, with authoritative rules and registration instructions.

  function handleMemberAdd(member) {
    if (!enabled || stopped || !member?.guild?.id || !member.user?.id || member.user.bot) return Promise.resolve(false);
    for (const [key, at] of sent) if (at <= now() - 24 * 3600_000) sent.delete(key);
    const key = `${member.guild.id}:${member.user.id}:${member.joinedTimestamp ?? "join"}`;
    if (sent.has(key)) return Promise.resolve(false);
    if (active.has(key)) return active.get(key);
    const task = send(member, key).catch(() => {
      console.error("[Welcome] Could not send the new-member welcome; check channel access and Send Messages permission.");
      return false;
    }).finally(() => active.delete(key));
    active.set(key, task);
    return task;
  } // Coalesce duplicate join events, skip bots, and permit a new welcome when the same member later rejoins.

  return {
    handleMemberAdd,
    async stop() { stopped = true; await Promise.allSettled([...active.values()]); },
  }; // Drain in-flight Discord requests before shutdown destroys the client; no historical-member scan or startup pings.
}
