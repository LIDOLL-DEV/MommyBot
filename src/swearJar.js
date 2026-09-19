import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { WalletError } from "./wallet/client.js";
import { swearJarPaymentText, swearJarBalanceText, swearJarOptOutText, SWEAR_OPTOUT_COST } from "./wallet/swearJar.js";
import { generateSwearJarMessage } from "./graph/swearJarMessage.js";
import { classifySwearApology, isSwearApologyCandidate } from "./graph/swearJarApology.js";
import { currentPronouns } from "./bot/pronouns.js";

export function buildSwearJarCommand() {
  return new SlashCommandBuilder().setName("swearjar").setDescription("Manage your swear jar")
    .addSubcommand(c => c.setName("optout").setDescription(`Pay ${SWEAR_OPTOUT_COST} LiDollcoins to pause swear jar fines for three hours`));
} // Register a dedicated command so the break never replaces another application's slash commands.

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

const APOLOGY_REPLY = "Thank you for apologizing, sweetheart. MommyBot appreciates you owning it. Let's try gentle words next time. 💗";
const APOLOGY_REQUEST = "Now, a proper little apology for Mommy, please: **sorry mommy**, **sorry mommy Sakura**, or **sorry mommybot**.";
const APOLOGY_REMINDER = `Mind your manners and act your age, sweetheart. Mommy is still waiting for your cute apology! ${APOLOGY_REQUEST}`;

export function swearJarStatus(env = process.env, { wallet = env.LIDOLLCOIN_ENABLED === "true", identities = env.LIDOLLID_ENABLED === "true" } = {}) {
  if (!wallet || !identities) return "OFF: requires LIDOLLID_ENABLED=true and LIDOLLCOIN_ENABLED=true.";
  if (env.SWEAR_JAR_ENABLED === "false") return "PAUSED: SWEAR_JAR_ENABLED=false; saved payments and weekly lotteries still recover.";
  const words = env.SWEAR_JAR_WORDS === undefined ? DEFAULT_SWEAR_WORDS : env.SWEAR_JAR_WORDS.split(",");
  const count = words.filter(word => word.trim()).length;
  return count ? `ON: 1 coin per matching server message; ${count} configured words and all server channels by default; each server may replace the words, exempt channels and sell 3-hour breaks in the admin panel; lottery Monday 00:00 UTC.` :
    "NO MATCHES: SWEAR_JAR_WORDS is empty. Remove that setting to use the built-in list.";
} // Explain every configuration that can silently bypass swear detection without printing message content or account information.

export function createSwearJar(client, wallet, identities, env = process.env, {
  generateMessage = generateSwearJarMessage, classifyApology = classifySwearApology, serverEnabled = () => true,
  serverWords = () => null,
} = {}) {
  console.log(`[Swear jar] ${swearJarStatus(env, { wallet: Boolean(wallet), identities: Boolean(identities) })}`);
  if (!wallet || !identities) return null;
  const enabled = env.SWEAR_JAR_ENABLED !== "false";
  const matches = swearMatcher(env.SWEAR_JAR_WORDS === undefined ? DEFAULT_SWEAR_WORDS : env.SWEAR_JAR_WORDS.split(","));
  const compiled = new Map();
  function matcherFor(guildId) {
    const words = serverWords(guildId);
    if (!words?.length) return matches;
    const key = words.join("\n"), cached = compiled.get(guildId);
    if (cached?.key === key) return cached.test;
    const test = swearMatcher(words);
    compiled.set(guildId, { key, test });
    return test;
  } // Compile each server's list once and rebuild it only when an administrator saves different words.
  const jar = wallet.swearJar, notices = new Set(), active = new Set();
  let timer, ticking, stopped = false;

  async function notify(job, message = null) {
    const paidFollowup = job.kind === "credit" && job.notified && job.state === "done" && !job.paid_notified;
    if ((job.notified && !paidFollowup) || notices.has(job.id)) return;
    notices.add(job.id);
    try {
      const pronouns = await currentPronouns(message?.guild || client.guilds?.cache?.get(job.guild_id), job.user_id, message?.member);
      let wording = job.kind === "debit" && jar.apology(job.id) ? "apology" : job.kind;
      let prose = await generateMessage(wording, { env, pronouns }).catch(() => null);
      let channel;
      if (!message) {
        if (job.kind === "credit" && env.SWEAR_JAR_CHANNEL_ID) {
          channel = await client.channels.fetch(env.SWEAR_JAR_CHANNEL_ID).catch(() => null);
        } // An unavailable lottery channel must not prevent fines from replying in their original channel.
        if (channel?.guildId !== job.guild_id || job.kind === "debit") channel = await client.channels.fetch(job.channel_id);
        if (!channel?.isTextBased() || channel.guildId !== job.guild_id) throw new Error("Swear jar channel unavailable");
      }
      if (job.kind === "debit" && wording !== "apology" && jar.apology(job.id)) {
        wording = "apology";
        prose = await generateMessage(wording, { env, pronouns }).catch(() => null);
      } // An apology arriving during generation replaces the old scolding with a chat-generated acknowledgment.
      job = jar.get(job.id); // Generation and channel lookup may outlast a payment; refresh facts immediately before sending.
      const apology = job.kind === "debit" ? jar.apology(job.id) : null;
      let content;
      if (job.kind === "debit") {
        content = "Sweetheart, MommyBot asks you to put **1 coin in the swear jar** for swearing. ";
        content += job.reason === "unlinked" ? "You need to make a **LiD0llID account** if you don't have one, then register it with MommyBot using /lidollid login. No coin was collected." :
          job.reason === "wallet" ? "Please use /lidollid login to connect your wallet. No coin was collected." :
          job.state === "pending" ? "Your 1-coin payment is pending. Use /lidollid wallet retry if needed; MommyBot will retry automatically." : swearJarPaymentText(job);
        if (!apology) content += `\n\n${APOLOGY_REQUEST}`;
      } else {
        content = paidFollowup ? `<@${job.user_id}>, ${swearJarPaymentText(job)}` :
          `The weekly swear jar lottery winner is <@${job.user_id}>! Congratulations, sweetheart! **${job.amount} LiDollcoins** ${job.state === "done" ? "have been gifted to your wallet!" : "are reserved for you. Use /lidollid login to connect your wallet, then /lidollid wallet retry to collect your prize."}`;
      }
      const intro = apology ? prose || APOLOGY_REPLY : prose;
      content = `${intro ? `${intro}\n\n` : ""}${content}\n\n${swearJarBalanceText(jar.balance(job.guild_id))}`;
      const options = { content, allowedMentions: { parse: [], users: job.kind === "credit" ? [job.user_id] : [], repliedUser: true } };
      if (message) await message.reply(options);
      else {
        await channel.send({ ...options, ...(job.message_id ? { reply: { messageReference: job.message_id, failIfNotExists: false } } : {}) });
      }
      jar.db.prepare("UPDATE swear_jar_jobs SET notified=1,paid_notified=? WHERE id=?").run(job.kind === "credit" && job.state === "done" ? 1 : 0, job.id);
      if (apology) jar.db.prepare("UPDATE swear_jar_apologies SET notified=1 WHERE job_id=?").run(job.id);
    } catch { console.error(`[Swear jar] Could not send a notice in guild ${job.guild_id}; it remains saved for retry.`); }
    finally { notices.delete(job.id); }
  } // Generate friendly replies with exact public jar totals; keep personal wallet balances and credentials private.

  async function notifyFollowup(kind, entry, message = null) {
    const table = kind === "apology" ? "swear_jar_apologies" : "swear_jar_reminders";
    const key = `followup:${entry.job_id}`, job = jar.get(entry.job_id);
    const current = kind === "apology" ? jar.apology(job.id) : jar.reminder(job.id);
    if (current.notified || !job.notified || notices.has(job.id) || notices.has(key) || kind === "reminder" && jar.apology(job.id)) return;
    notices.add(key);
    try {
      const pronouns = await currentPronouns(message?.guild || client.guilds?.cache?.get(job.guild_id), job.user_id, message?.member);
      const prose = await generateMessage(kind, { env, pronouns }).catch(() => null);
      if (kind === "reminder" && jar.apology(job.id)) return; // A proper apology during generation cancels the pending scolding.
      const content = kind === "apology" ? prose || APOLOGY_REPLY : prose ? `${prose}\n\n${APOLOGY_REQUEST}` : APOLOGY_REMINDER;
      const options = { content, allowedMentions: { parse: [], users: [], repliedUser: true } };
      if (message && message.id === entry.message_id) await message.reply(options);
      else {
        const channel = await client.channels.fetch(job.channel_id);
        if (!channel?.isTextBased() || channel.guildId !== job.guild_id) throw new Error("Swear jar channel unavailable");
        if (kind === "reminder" && jar.apology(job.id)) return; // Channel lookup can outlast an accepted apology; do not send the canceled reminder.
        await channel.send({ ...options, reply: { messageReference: entry.message_id, failIfNotExists: false } });
      }
      jar.db.prepare(`UPDATE ${table} SET notified=1 WHERE job_id=?`).run(job.id);
    } catch { console.error(`[Swear jar] Could not send an apology follow-up in guild ${job.guild_id}; it remains saved for retry.`); }
    finally { notices.delete(key); }
  } // Generate acknowledgment or reminder wording through chat, retain fixed fallbacks, and select table names internally.

  async function handle(message) {
    if (stopped || !enabled || !message.guildId || message.author?.bot || message.webhookId) return false;
    const swore = matcherFor(message.guildId)(message.content), candidate = isSwearApologyCandidate(message.content);
    if (!swore && (!message.content?.trim() || /^[!/]/.test(message.content.trim()))) return false;
    if (jar.optedOut(message.guildId, message.author.id)) return false; // A paid break pauses fines, reminders and apology handling alike, and leaves the message to ordinary chat.
    const activity = Symbol(`message:${message.id}`);
    active.add(activity);
    let job;
    try {
      while (!stopped && wallet.locks.has(message.author.id)) await new Promise(resolve => setTimeout(resolve, 25));
      if (stopped) return true;
      if (!swore) {
        const recent = jar.recentSwear(message);
        if (!recent) return false; // Leave unrelated apologies to ordinary conversation handling without an AI request.
        const previous = jar.apology(recent.id);
        if (previous) {
          if (message.id !== previous.message_id) return false;
          await notifyFollowup("apology", previous, message); return true;
        }
        if (candidate && await classifyApology(message.content, { env })) {
          const apology = jar.recordApology(message, recent); // Bind to the fine observed before classification, not a newer swear.
          await notifyFollowup("apology", apology, message);
          return true;
        }
        if (jar.apology(recent.id)) return true; // A concurrent accepted apology cancels any pending correction.
        const reminder = jar.reminder(recent.id);
        if (reminder && reminder.message_id !== message.id) return false;
        await notifyFollowup("reminder", reminder ?? jar.recordReminder(message, recent), message);
        return true;
      }
      const recorded = jar.record(message, identities.get(message.author.id));
      if (!recorded.fresh) return true;
      job = recorded.job;
      active.add(job.id); // Check the lock and journal synchronously so an in-flight unlink cannot strand a new fine.
      if (candidate && await classifyApology(message.content, { env })) jar.recordApology(message, job);
      if (job.state === "pending") await jar.settle(job.id).catch(() => {});
      await notify(jar.get(job.id), message);
      const apology = jar.apology(job.id);
      if (apology) await notifyFollowup("apology", apology); // Catch an apology that arrived while Discord was sending the original notice.
      const reminder = jar.reminder(job.id);
      if (reminder) await notifyFollowup("reminder", reminder);
    } finally { active.delete(activity); if (job) active.delete(job.id); }
    return true;
  } // Run before the conversation channel gate so every human server message follows the same swear jar rule.

  async function optOut(interaction) {
    const refusal = !interaction.guildId ? "Ask for your swear jar break in the server where you would like it, sweetheart." :
      !enabled || !serverEnabled(interaction.guildId) ? "MommyBot is not collecting swear jar fines in this server right now, so there is nothing to buy a break from." : null;
    if (refusal) { await interaction.reply({ content: refusal, flags: MessageFlags.Ephemeral }); return; }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let content;
    try {
      const { record, fresh } = await jar.optOut(interaction.guildId, interaction.user.id, identities.get(interaction.user.id));
      content = fresh ? swearJarPaymentText(record, wallet.now()) : `You already have a swear jar break, sweetheart. ${swearJarOptOutText(record, wallet.now())}`;
    } catch (error) {
      content = error instanceof WalletError ? error.message : "The swear jar could not reach your wallet. Try again; any saved payment recovers with /lidollid wallet retry.";
    }
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  } // Keep the purchase private and quote only stored payment facts, never a wallet balance or account detail.

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
    for (const record of jar.db.prepare("SELECT id FROM swear_jar_optouts WHERE state='pending' ORDER BY created,id").all()) {
      if (stopped) return;
      if (!active.has(record.id)) await jar.settleOptOut(record.id).catch(() => {});
    } // Finish a break whose receipt was lost; its three hours begin only when that payment is confirmed.
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
    for (const apology of jar.db.prepare("SELECT * FROM swear_jar_apologies WHERE notified=0").all()) {
      if (stopped) return;
      await notifyFollowup("apology", apology);
    } // Retry acknowledgments after Discord outages or restarts without repeating wallet operations.
    for (const reminder of jar.db.prepare("SELECT * FROM swear_jar_reminders WHERE notified=0").all()) {
      if (stopped) return;
      await notifyFollowup("reminder", reminder);
    }
  } // Resume overdue draws after downtime; disabling new fines still allows existing money and notices to settle.

  function tick() {
    if (stopped) return Promise.resolve();
    if (!ticking) ticking = runTick().catch(() => console.error("[Swear jar] Maintenance could not finish; it will retry.")).finally(() => { ticking = null; });
    return ticking;
  } // A slow wallet or membership lookup cannot overlap two scheduled draws in this process.

  return {
    handleMessage: handle,
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== "swearjar" || interaction.options.getSubcommand() !== "optout") return false;
      const activity = Symbol(`optout:${interaction.id}`);
      active.add(activity);
      try { await optOut(interaction); }
      catch { console.error("[Swear jar] Could not answer a break purchase; any payment remains saved for /lidollid wallet retry."); }
      finally { active.delete(activity); }
      return true;
    }, // Own only this command so other applications' slash commands keep reaching their own handlers.
    async registerGuild(guild) {
      try { await guild.commands.create(buildSwearJarCommand()); }
      catch { console.error(`[Swear jar] Could not register /swearjar in guild ${guild.id}.`); }
    },
    tick,
    start() { if (!timer && !stopped) { timer = setInterval(() => void tick(), 60_000); timer.unref(); void tick(); } },
    async stop() { stopped = true; clearInterval(timer); await ticking; while (active.size) await new Promise(resolve => setTimeout(resolve, 25)); },
  }; // Start after Discord readiness and drain work before identity and wallet databases close.
}
