export async function conversationContext(message, botId, { timeoutMs = 1500 } = {}) {
  const now = message.createdTimestamp || Date.now(), channelId = message.channelId || message.channel.id;
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const bounded = task => Promise.race([Promise.resolve().then(task).catch(() => null), deadline]);
  try {
    const [fetched, referenced] = await Promise.all([
      bounded(() => message.channel.messages?.fetch({ limit: 12, before: message.id, cache: false })),
      message.reference?.messageId ? bounded(() => message.fetchReference()) : null,
    ]);
    const labels = new Map([[botId, "sakura"], [message.author.id, "current_member"]]);
    const label = id => { if (!labels.has(id)) labels.set(id, `other_member_${labels.size - 1}`); return labels.get(id); };
    const mentions = item => [...(item.mentions?.users?.keys?.() || [])].map(label).slice(0, 10);
    const summarize = item => ({
      speaker: label(item.author.id), automated: Boolean(item.author.bot),
      text: (item.content || "").slice(0, 600), ageSeconds: Math.max(0, Math.floor((now - item.createdTimestamp) / 1000)),
      mentions: mentions(item),
    }); // Stable speaker labels distinguish participants without treating their display names as prompt instructions.
    const eligible = item => item?.author?.id && (item.channelId || item.channel?.id) === channelId && item.id !== message.id &&
      Number.isFinite(item.createdTimestamp) && item.createdTimestamp <= now && now - item.createdTimestamp <= 5 * 60_000;
    const recent = [...(fetched?.values?.() || message.channel.messages?.cache?.values?.() || [])]
      .filter(eligible).sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(-12).map(summarize);
    const reply = referenced || fetched?.get?.(message.reference?.messageId) || message.channel.messages?.cache?.get?.(message.reference?.messageId);
    const target = reply?.author?.id && (reply.channelId || reply.channel?.id) === channelId ? reply : null;
    return {
      isDM: !message.guildId, directMention: Boolean(message.mentions?.users?.has(botId)), mentions: mentions(message),
      replyTo: target ? label(target.author.id) : message.reference?.messageId ? "unknown" : null,
      replyTarget: target ? summarize(target) : null, recent,
    };
  } finally { clearTimeout(timer); }
} // Read only this channel's five-minute window; missing history permissions or slow Discord requests cannot stall routing.
