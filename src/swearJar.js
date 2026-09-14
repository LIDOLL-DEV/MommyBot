import { swearJarPaymentText } from "./wallet/swearJar.js";

export const DEFAULT_SWEAR_WORDS = [
  "fuck", "fucks", "fucked", "fucking", "fucker", "fuckers", "motherfucker", "motherfuckers", "motherfucking",
  "shit", "shits", "shitty", "shitting", "bullshit", "bitch", "bitches", "bitching", "bastard", "bastards",
  "ass", "asshole", "assholes", "arse", "arsehole", "damn", "damned", "goddamn", "hell", "crap",
  "piss", "pissed", "pissing", "dick", "dicks", "cock", "cocks", "cunt", "cunts",
];

export function swearMatcher(words = DEFAULT_SWEAR_WORDS) {
  const terms = words.map(word => word.trim().normalize("NFKC").toLowerCase()).filter(Boolean);
  const escaped = terms.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = escaped.length ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{M}\\p{N}_])`, "u") : null;
  return content => Boolean(pattern?.test(String(content ?? "").normalize("NFKC").toLowerCase()));
} // Match explicit whole words without charging innocent substrings such as class, Scunthorpe or hello.

export function swearJarStatus(env = process.env, { wallet = env.LIDOLLCOIN_ENABLED === "true", identities = env.LIDOLLID_ENABLED === "true" } = {}) {
  if (!wallet || !identities) return "OFF: requires LIDOLLID_ENABLED=true and LIDOLLCOIN_ENABLED=true.";
  if (env.SWEAR_JAR_ENABLED === "false") return "PAUSED: SWEAR_JAR_ENABLED=false; saved payments and weekly lotteries still recover.";
  const words = env.SWEAR_JAR_WORDS === undefined ? DEFAULT_SWEAR_WORDS : env.SWEAR_JAR_WORDS.split(",");
  const count = words.filter(word => word.trim()).length;
  return count ? `ON: 1 coin per matching server message; ${count} configured words; all server channels; lottery Monday 00:00 UTC.` :
    "NO MATCHES: SWEAR_JAR_WORDS is empty. Remove that setting to use the built-in list.";
} // Explain every configuration that can silently bypass swear detection without printing message content or account information.

export function createSwearJar(client, wallet, identities, env = process.env) {
  console.log(`[Swear jar] ${swearJarStatus(env, { wallet: Boolean(wallet), identities: Boolean(identities) })}`);
  if (!wallet || !identities) return null;
  const enabled = env.SWEAR_JAR_ENABLED !== "false";
  const matches = swearMatcher(env.SWEAR_JAR_WORDS === undefined ? DEFAULT_SWEAR_WORDS : env.SWEAR_JAR_WORDS.split(","));
  const jar = wallet.swearJar, notices = new Set(), active = new Set();
  let timer, ticking, stopped = false;

  async function notify(job, message = null) {
    const paidFollowup = job.kind === "credit" && job.notified && job.state === "done" && !job.paid_notified;
    if ((job.notified && !paidFollowup) || notices.has(job.id)) return;
    notices.add(job.id);
    try {
      let content;
      if (job.kind === "debit") {
        content = "MommyBot asks you to put **1 coin in the swear jar** for swearing. ";
        content += job.reason === "unlinked" ? "You need to make a **LiD0llID account** if you don't have one, then register it with MommyBot using /lidollid login. No coin was collected." :
          job.reason === "wallet" ? "Please use /lidollid login to connect your wallet. No coin was collected." :
          job.state === "pending" ? "Your 1-coin payment is pending. Use /lidollid wallet retry if needed; MommyBot will retry automatically." : swearJarPaymentText(job);
      } else {
        content = paidFollowup ? `<@${job.user_id}>, ${swearJarPaymentText(job)}` :
          `The weekly swear jar lottery winner is <@${job.user_id}>! **${job.amount} LiDollcoins** ${job.state === "done" ? "have been gifted to your wallet!" : "are reserved for you. Use /lidollid login to connect your wallet, then /lidollid wallet retry to collect your prize."}`;
      }
      const options = { content, allowedMentions: { parse: [], users: job.kind === "credit" ? [job.user_id] : [], repliedUser: true } };
      if (message) await message.reply(options);
      else {
        let channel = null;
        if (job.kind === "credit" && env.SWEAR_JAR_CHANNEL_ID) {
          channel = await client.channels.fetch(env.SWEAR_JAR_CHANNEL_ID).catch(() => null);
        } // An unavailable lottery channel must not prevent fines from replying in their original channel.
        if (channel?.guildId !== job.guild_id || job.kind === "debit") channel = await client.channels.fetch(job.channel_id);
        if (!channel?.isTextBased() || channel.guildId !== job.guild_id) throw new Error("Swear jar channel unavailable");
        await channel.send({ ...options, ...(job.message_id ? { reply: { messageReference: job.message_id, failIfNotExists: false } } : {}) });
      }
      jar.db.prepare("UPDATE swear_jar_jobs SET notified=1,paid_notified=? WHERE id=?").run(job.kind === "credit" && job.state === "done" ? 1 : 0, job.id);
    } catch { console.error(`[Swear jar] Could not send a notice in guild ${job.guild_id}; it remains saved for retry.`); }
    finally { notices.delete(job.id); }
  } // Keep public replies free of balances, credentials and quoted profanity; retry unsent notices independently of payments.

  async function handle(message) {
    if (stopped || !enabled || !message.guildId || message.author?.bot || message.webhookId || !matches(message.content)) return false;
    const activity = Symbol(`message:${message.id}`);
    active.add(activity);
    let job;
    try {
      while (!stopped && wallet.locks.has(message.author.id)) await new Promise(resolve => setTimeout(resolve, 25));
      if (stopped) return true;
      const recorded = jar.record(message, identities.get(message.author.id));
      if (!recorded.fresh) return true;
      job = recorded.job;
      active.add(job.id); // Check the lock and journal synchronously so an in-flight unlink cannot strand a new fine.
      if (job.state === "pending") await jar.settle(job.id).catch(() => {});
      await notify(jar.get(job.id), message);
    } finally { active.delete(activity); if (job) active.delete(job.id); }
    return true;
  } // Run before the conversation channel gate so every human server message follows the same swear jar rule.

  async function candidates(guild) {
    const eligible = [];
    for (const identity of identities.discordLinks()) {
      try {
        const member = await guild.members.fetch({ user: identity.discord_id, force: true });
        if (!member.user.bot) eligible.push(identity);
      } catch (error) {
        if (Number(error.code) !== 10007) throw error;
      } // Ignore confirmed departed members; temporary Discord errors defer the entire draw instead of biasing its entrants.
    }
    return eligible;
  } // Query linked Discord users individually, including quiet members, without requiring the privileged member-list intent.

  async function runTick() {
    for (const job of jar.db.prepare("SELECT * FROM swear_jar_jobs WHERE state='pending' ORDER BY created,id").all()) {
      if (stopped) return;
      if (!active.has(job.id)) await jar.settle(job.id).catch(() => {});
    }
    for (const guild of jar.db.prepare("SELECT * FROM swear_jar_guilds WHERE next_draw<=?").all(wallet.now())) {
      if (stopped) return;
      try {
        const server = client.guilds.cache.get(guild.guild_id);
        if (!server) continue;
        const entrants = await candidates(server);
        if (stopped) return;
        const prize = jar.reserve(guild.guild_id, guild.next_draw, entrants);
        if (prize) await jar.settle(prize.id).catch(() => {});
      } catch { console.error(`[Swear jar] Weekly draw deferred in guild ${guild.guild_id}; its coins remain saved.`); }
    }
    for (const job of jar.db.prepare("SELECT * FROM swear_jar_jobs WHERE notified=0 OR (kind='credit' AND state='done' AND paid_notified=0)").all()) {
      if (stopped) return;
      if (!active.has(job.id)) await notify(job);
    }
  } // Resume overdue draws after downtime; disabling new fines still allows existing money and notices to settle.

  function tick() {
    if (stopped) return Promise.resolve();
    if (!ticking) ticking = runTick().catch(() => console.error("[Swear jar] Maintenance could not finish; it will retry.")).finally(() => { ticking = null; });
    return ticking;
  } // A slow wallet or membership lookup cannot overlap two scheduled draws in this process.

  return {
    handleMessage: handle,
    tick,
    start() { if (!timer && !stopped) { timer = setInterval(() => void tick(), 60_000); timer.unref(); void tick(); } },
    async stop() { stopped = true; clearInterval(timer); await ticking; while (active.size) await new Promise(resolve => setTimeout(resolve, 25)); },
  }; // Start after Discord readiness and drain work before identity and wallet databases close.
}
