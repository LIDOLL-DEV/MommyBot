import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { generateDiaperCheckMessage } from "../graph/diaperCheckMessage.js";
import { classifyDiaperReply } from "../graph/diaperCheckReply.js";
import { currentPronouns } from "../bot/pronouns.js";
import { DiaperCheckStore, silentHour, ANSWER_WINDOW_MS } from "./store.js";

const ASK_REQUEST = "Please answer Mommy with **yes** or **no**.";
const FALLBACKS = {
  ask: "Sweetheart, Mommy needs to know: have you had an accident and do you need a change?",
  "ask-random": "Diaper check, sweetheart! Mommy would like a little status update.",
  confirmed: "Thank you for telling Mommy the truth, sweetheart. Accidents are perfectly okay. Let's get you changed. 💗",
  denied: "Sweetheart, Mommy's records say otherwise, and fibbing to Mommy is not okay. Please be honest with Mommy next time, and let's get you changed.",
  undiapered: "Sweetheart, you are not wearing your protection, and that simply will not do. Please go and put a fresh one on for Mommy right now, then tell Mommy you are all set.",
  status: "Thank you for checking in with Mommy, sweetheart. Tell Mommy the moment you need a change. 💗",
  unclear: "Mommy could not quite tell, sweetheart.",
}; // Every notice has a fixed, factual wording so a missing AI server never blocks or garbles a check.

export function buildDiaperCheckCommand() {
  return new SlashCommandBuilder().setName("diapercheck").setDescription("Diaper check tools")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false)
    .addSubcommand(c => c.setName("ask").setDescription("(Admin) Ask a member for a diaper status update now")
      .addUserOption(o => o.setName("member").setDescription("Participating member to check").setRequired(true)));
} // Discord hides the command from non-administrators, and the handler rechecks the live permission before acting.

export function diaperCheckStatus(env = process.env, { identities = env.LIDOLLID_ENABLED === "true", care = true } = {}) {
  if (env.DIAPER_CHECKS_ENABLED !== "true") return "OFF: set DIAPER_CHECKS_ENABLED=true to run diaper checks.";
  if (!identities) return "OFF: requires LIDOLLID_ENABLED=true so Littlepottchi care state can be matched to Discord members.";
  if (!care) return "OFF: Littlepottchi is unavailable, so there is no care state to read.";
  return "ON: accident checks from live Littlepottchi care state, random checks every 6-12 hours, quiet 22:00-06:00 server time; each server chooses its channel and role.";
} // Explain every configuration that silently prevents checks, without printing records or member identities.

export function createDiaperChecks(client, identities, env = process.env, {
  generateMessage = generateDiaperCheckMessage, classifyReply = classifyDiaperReply,
  settings = () => null, audit = () => {}, store, care = null, now = Date.now, isSilent = time => silentHour(time),
  interval = 60_000,
} = {}) {
  console.log(`[Diaper check] ${diaperCheckStatus(env, { identities: Boolean(identities), care: Boolean(care) })}`);
  if (env.DIAPER_CHECKS_ENABLED !== "true" || !identities || !care) return null;
  const journal = store ?? new DiaperCheckStore(env.DIAPER_CHECKS_DB || "data/diaperchecks.db", { now });
  const active = new Set(), notices = new Set();
  let timer, ticking, stopped = false;

  function guildSettings(guildId) {
    const saved = settings(guildId)?.diaperChecks;
    if (!saved?.enabled || !saved.channel) return null;
    return saved;
  } // A server takes part only once an administrator has enabled checks and chosen a channel.

  async function eligible(guildId, userId) {
    const saved = guildSettings(guildId);
    if (!saved) return null;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    let member;
    try { member = await guild.members.fetch({ user: userId, force: true }); }
    catch (error) { if (Number(error.code) === 10007) return null; throw error; }
    if (member.user.bot) return null;
    if (saved.role && !member.roles.cache.has(saved.role)) return null; // The configured role is the opt-in for being asked at all.
    return { settings: saved, guild, member };
  } // Check current membership and the opt-in role for every question, so a departure or opt-out stops checks immediately.

  async function send(check, kind, { reply = null } = {}) {
    const key = `${check.id}:${kind}`;
    if (notices.has(key)) return false;
    notices.add(key);
    try {
      const context = await eligible(check.guild_id, check.user_id);
      if (!context) return false;
      const pronouns = await currentPronouns(context.guild, check.user_id, context.member);
      const prose = await generateMessage(kind, { env, pronouns }).catch(() => null);
      const intro = prose || FALLBACKS[kind];
      const asking = kind === "ask" || kind === "ask-random" || kind === "unclear";
      const content = `${intro}\n\n<@${check.user_id}>${asking ? `, ${ASK_REQUEST}` : ""}`;
      const options = { content, allowedMentions: { parse: [], users: [check.user_id], repliedUser: true } };
      if (reply) { await reply.reply(options); return true; }
      const channel = await client.channels.fetch(check.channel_id);
      if (!channel?.isTextBased() || channel.guildId !== check.guild_id) throw new Error("Diaper check channel unavailable");
      const sent = await channel.send(options);
      if (kind === "ask" || kind === "ask-random") journal.markAsked(check.id, sent?.id);
      return true;
    } catch {
      console.error(`[Diaper check] Could not send a ${kind} notice in guild ${check.guild_id}; it remains saved for retry.`);
      return false;
    } finally { notices.delete(key); }
  } // Mention only the member being asked, quote no record, and leave an unsent question journaled for the next pass.

  async function ask(check) {
    const kind = check.kind === "evidence" ? "ask" : "ask-random"; // Only an accident-backed check asks about an accident; random and admin checks ask for a status update.
    if (await send(check, kind)) return;
    if (journal.get(check.id)?.asked === 0 && now() - check.created > ANSWER_WINDOW_MS) {
      journal.db.prepare("UPDATE diaper_checks SET state='expired',notified=1 WHERE id=? AND asked=0").run(check.id);
    } // A question that could not be delivered within its own answer window is abandoned rather than asked far too late.
  }

  const outcome = check => check.answer === "undiapered" ? "undiapered" : check.answer === "yes" ? "confirmed" : check.event_id ? "denied" : "status";
  // Only a denial contradicted by a saved accident event is treated as a fib; a random check has nothing to contradict.

  async function finish(check) {
    if (await send(check, outcome(check))) journal.markNotified(check.id);
  }

  async function handleMessage(message) {
    if (stopped || !message.guildId || message.author?.bot || message.webhookId) return false;
    if (!message.content?.trim()) return false;
    const check = journal.open(message.guildId, message.author.id);
    if (!check || !check.asked || check.channel_id !== message.channelId) return false;
    if (now() - check.created > ANSWER_WINDOW_MS) return false; // A stale question is closed by maintenance, not answered here.
    const activity = Symbol(`diaper:${message.id}`);
    active.add(activity);
    try {
      const answer = await classifyReply(message.content, { env });
      if (answer === "unclear") {
        if (!journal.markClarified(check.id)) return false; // Further unclear chatter belongs to ordinary conversation.
        await send(check, "unclear", { reply: message });
        return true;
      }
      const answered = journal.answer(check.id, answer);
      if (!answered || answered.notified) return true;
      if (answer === "no" && answered.event_id) {
        audit(check.guild_id, "bot", "diaper-check.denied",
          `Member ${check.user_id} answered no to a recorded ${check.event_kind ?? "accident"} check.`);
      } // Give server administrators the record they asked for, without a coin cost or any public accusation beyond the reply.
      if (await send(answered, outcome(answered), { reply: message })) journal.markNotified(check.id);
      return true;
    } finally { active.delete(activity); }
  } // Answer only the member's own open question in its own channel; every other message passes straight through.

  async function askNow(interaction) {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Only a server administrator can start a diaper check.", flags: MessageFlags.Ephemeral });
      return;
    } // Recheck the caller's live permission; Discord's default-permission hint alone is not an authorization check.
    const saved = guildSettings(interaction.guildId);
    if (!saved) {
      await interaction.reply({ content: "This server has no diaper check channel yet. Choose one in MommyBot's admin panel first.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const target = interaction.options.getUser("member", true);
    let content;
    try {
      const context = await eligible(interaction.guildId, target.id).catch(() => null);
      if (!context) content = `<@${target.id}> is not taking part in diaper checks. Members opt in by holding the configured role.`;
      else if (journal.openAnywhere(target.id)) content = `<@${target.id}> already has a diaper check waiting for an answer.`;
      else {
        const { check, fresh } = journal.record({ guild: interaction.guildId, user: target.id, channel: saved.channel, kind: "manual" });
        if (!fresh || !check) content = `<@${target.id}> already has a diaper check waiting for an answer.`;
        else {
          await ask(check);
          content = journal.get(check.id)?.asked
            ? `Asked <@${target.id}> in <#${saved.channel}>. Their next six to twelve hour window starts now.`
            : `The question for <@${target.id}> is saved but could not be sent; MommyBot will retry. Check its permissions in <#${saved.channel}>.`;
        }
      }
    } catch { content = "MommyBot could not start that diaper check. Try again shortly."; }
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  } // An administrator may ask at any hour, including quiet hours, because the request is deliberate and immediate.

  async function poll() {
    for (const accident of care.accidents()) {
      if (stopped) return;
      if (journal.seen({ id: accident.id, sequence: 0, kind: accident.kind })) continue;
      for (const guild of client.guilds.cache.keys()) {
        const context = await eligible(guild, accident.discordId);
        if (!context) continue;
        journal.record({ guild, user: accident.discordId, channel: context.settings.channel,
          kind: "evidence", event: accident.id, eventKind: accident.kind });
      }
    }
  } // Each accident episode is journaled by its own key the first time it is seen, so a member is asked about it exactly once.

  async function randomChecks() {
    for (const guildId of client.guilds.cache.keys()) {
      if (stopped) return;
      const saved = guildSettings(guildId);
      if (!saved?.role) continue; // Random checks need a role to choose from.
      const linked = identities.discordLinks().map(link => link.discord_id);
      const overdue = journal.due(guildId, linked);
      while (overdue.length) {
        if (stopped) return;
        const pick = overdue.splice(journal.draw(overdue.length), 1)[0];
        if (journal.openAnywhere(pick)) continue;
        const context = await eligible(guildId, pick).catch(() => null);
        if (!context) { journal.reschedule(guildId, pick); continue; } // A departed or opted-out member simply waits another window.
        journal.record({ guild: guildId, user: pick, channel: saved.channel, kind: "random" });
        break; // One random check per server per pass keeps the channel calm.
      }
    }
  } // Choose uniformly among overdue role members rather than always asking the longest-waiting one.

  async function runTick() {
    journal.expire(now());
    try { await poll(); }
    catch { console.error("[Diaper check] Could not read Littlepottchi care state; it will retry."); }
    if (stopped) return;
    if (!isSilent(now())) {
      try { await randomChecks(); }
      catch { console.error("[Diaper check] Could not schedule a random check; it will retry."); }
      for (const check of journal.unsent()) {
        if (stopped) return;
        await ask(check);
      }
    } // Quiet hours delay new questions; saved questions and answers still recover afterwards.
    for (const check of journal.unfinished()) {
      if (stopped) return;
      await finish(check);
    }
    journal.prune();
  } // Recover unsent questions and unsent answers after an outage without re-reading or re-asking anything already journaled.

  function tick() {
    if (stopped) return Promise.resolve();
    if (!ticking) ticking = runTick().catch(() => console.error("[Diaper check] Maintenance could not finish; it will retry.")).finally(() => { ticking = null; });
    return ticking;
  } // A slow feed or Discord lookup cannot overlap two scheduled passes in this process.

  return {
    store: journal, handleMessage, tick,
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== "diapercheck" || interaction.options.getSubcommand() !== "ask") return false;
      const activity = Symbol(`diaper-command:${interaction.id}`);
      active.add(activity);
      try { await askNow(interaction); }
      catch { console.error("[Diaper check] Could not answer an administrator's check request."); }
      finally { active.delete(activity); }
      return true;
    }, // Own only this command so other applications' slash commands keep reaching their own handlers.
    async registerGuild(guild) {
      try { await guild.commands.create(buildDiaperCheckCommand()); }
      catch { console.error(`[Diaper check] Could not register /diapercheck in guild ${guild.id}.`); }
    },
    start() { if (!timer && !stopped) { timer = setInterval(() => void tick(), interval); timer.unref(); void tick(); } },
    async stop() { stopped = true; clearInterval(timer); await ticking; while (active.size) await new Promise(resolve => setTimeout(resolve, 25)); },
    close() { journal.close(); },
  }; // Start after Discord readiness and drain in-flight answers before closing the journal.
}
