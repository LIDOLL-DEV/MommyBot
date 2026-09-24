import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { generateDiaperCheckMessage, generateDiaperCheckReply } from "../graph/diaperCheckMessage.js";
import { classifyDiaperReply } from "../graph/diaperCheckReply.js";
import { currentPronouns } from "../bot/pronouns.js";
import { DiaperCheckStore, silentHour, ANSWER_WINDOW_MS } from "./store.js";

const ASK_REQUEST = "Are you **dry** or **wet**? Tell Mommy **dry** or **wet**.";
// Name both states so no answer depends on how a question was phrased; a bare yes or no is asked again.
const FALLBACKS = {
  ask: "Diaper check time, sweetheart! Mommy would like a little status update.",
  wet: "Thank you for telling Mommy, sweetheart. Accidents are perfectly okay. Let's get you into a fresh, dry diaper. 💗",
  dry: "Thank you for checking in with Mommy, sweetheart. Tell Mommy the moment you need a change. 💗",
  undiapered: "Sweetheart, you are not wearing your protection, and that simply will not do. Please go and put a fresh one on for Mommy right now, then tell Mommy you are all set.",
  unclear: "Mommy could not quite tell, sweetheart.",
  followup: "Mommy hears you, sweetheart. Thank you for keeping Mommy in the loop. 💗",
}; // Every notice has a fixed, factual wording so a missing AI server never blocks or garbles a check.

export function buildDiaperCheckCommand() {
  return new SlashCommandBuilder().setName("diapercheck").setDescription("Diaper check tools")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false)
    .addSubcommand(c => c.setName("ask").setDescription("(Admin) Ask a member for a diaper status update now")
      .addUserOption(o => o.setName("member").setDescription("Participating member to check").setRequired(true)));
} // Discord hides the command from non-administrators, and the handler rechecks the live permission before acting.

export function diaperCheckStatus(env = process.env, { identities = env.LIDOLLID_ENABLED === "true" } = {}) {
  if (env.DIAPER_CHECKS_ENABLED !== "true") return "OFF: set DIAPER_CHECKS_ENABLED=true to run diaper checks.";
  if (!identities) return "OFF: requires LIDOLLID_ENABLED=true so only LiDollID-verified members are asked.";
  return "ON: every 2-4 hours each server asks one LiDollID-verified member of its participating role, quiet 22:00-06:00 server time.";
} // Explain every configuration that silently prevents checks, without printing records or member identities.

export function createDiaperChecks(client, identities, env = process.env, {
  generateMessage = generateDiaperCheckMessage, generateReply = generateDiaperCheckReply, classifyReply = classifyDiaperReply,
  settings = () => null, store, now = Date.now, isSilent = time => silentHour(time), interval = 60_000,
} = {}) {
  console.log(`[Diaper check] ${diaperCheckStatus(env, { identities: Boolean(identities) })}`);
  if (env.DIAPER_CHECKS_ENABLED !== "true" || !identities) return null; // Only LiDollID-verified members are ever asked.
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
      const asking = kind === "ask" || kind === "unclear";
      const content = `${intro}\n\n<@${check.user_id}>${asking ? `, ${ASK_REQUEST}` : ""}`;
      const options = { content, allowedMentions: { parse: [], users: [check.user_id], repliedUser: true } };
      if (reply) { await reply.reply(options); return true; }
      const channel = await client.channels.fetch(check.channel_id);
      if (!channel?.isTextBased() || channel.guildId !== check.guild_id) throw new Error("Diaper check channel unavailable");
      const sent = await channel.send(options);
      if (kind === "ask") journal.markAsked(check.id, sent?.id);
      return true;
    } catch {
      console.error(`[Diaper check] Could not send a ${kind} notice in guild ${check.guild_id}; it remains saved for retry.`);
      return false;
    } finally { notices.delete(key); }
  } // Mention only the member being asked, quote no record, and leave an unsent question journaled for the next pass.

  async function ask(check) {
    if (await send(check, "ask")) return;
    if (journal.get(check.id)?.asked === 0 && now() - check.created > ANSWER_WINDOW_MS) {
      journal.db.prepare("UPDATE diaper_checks SET state='expired',notified=1 WHERE id=? AND asked=0").run(check.id);
    } // A question that could not be delivered within its own answer window is abandoned rather than asked far too late.
  }

  const LEGACY = { yes: "wet", no: "dry" }; // Answers saved before the question became "is your diaper dry?".
  const outcome = check => ["wet", "dry", "undiapered"].includes(check.answer) ? check.answer : LEGACY[check.answer] ?? "dry";
  // Mommy believes the member: there is no record left to contradict what they say.

  async function finish(check) {
    if (await send(check, outcome(check))) journal.markNotified(check.id);
  }

  async function followUp(message) {
    const recent = journal.recentAnswered(message.guildId, message.author.id, message.channelId, now());
    if (!recent) return false;
    const activity = Symbol(`diaper-followup:${message.id}`);
    active.add(activity);
    try {
      const context = await eligible(message.guildId, message.author.id).catch(() => null);
      if (!context) return false;
      journal.bumpFollowup(recent.id); // Count the exchange before replying, so a failed send cannot be retried into a loop.
      const answer = await classifyReply(message.content, { env });
      if (answer !== "unclear" && answer !== outcome(recent)) {
        await send(recent, answer, { reply: message });
        return true;
      } // A member who corrects themselves afterwards gets the matching reply, not a generic one.
      const pronouns = await currentPronouns(context.guild, message.author.id, context.member);
      const prose = await generateReply(message.content, { answer: outcome(recent), env, pronouns }).catch(() => null);
      await message.reply({ content: prose || FALLBACKS.followup, allowedMentions: { parse: [], users: [], repliedUser: true } });
      return true;
    } catch {
      console.error(`[Diaper check] Could not continue a conversation in guild ${message.guildId}.`);
      return true; // The member was answered or will be next time; never fall through to unrelated handling mid-exchange.
    } finally { active.delete(activity); }
  } // Keep talking briefly after a check closes: the check channel is usually outside CHANNEL_ID, so ordinary chat would never reply there.

  async function handleMessage(message) {
    if (stopped || !message.guildId || message.author?.bot || message.webhookId) return false;
    if (!message.content?.trim()) return false;
    const check = journal.open(message.guildId, message.author.id);
    if (!check || !check.asked || check.channel_id !== message.channelId) return followUp(message);
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
            ? `Asked <@${target.id}> in <#${saved.channel}>. The next random check here comes two to four hours from now.`
            : `The question for <@${target.id}> is saved but could not be sent; MommyBot will retry. Check its permissions in <#${saved.channel}>.`;
        }
      }
    } catch { content = "MommyBot could not start that diaper check. Try again shortly."; }
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  } // An administrator may ask at any hour, including quiet hours, because the request is deliberate and immediate.

  async function chooseCheck() {
    for (const guildId of client.guilds.cache.keys()) {
      if (stopped) return;
      const saved = guildSettings(guildId);
      if (!saved?.role) continue; // Checks need a role to choose from.
      if (journal.openInGuild(guildId)) continue; // Never ask a second member while a question is still waiting.
      if (!journal.due(guildId, now())) continue; // One check per server every two to four hours.
      let remaining = identities.discordLinks().map(link => link.discord_id).filter(user => !journal.openAnywhere(user));
      let asked = false;
      while (remaining.length) {
        if (stopped) return;
        const pick = journal.nextInCycle(guildId, remaining, now());
        remaining = remaining.filter(user => user !== pick);
        const context = await eligible(guildId, pick).catch(() => null);
        if (!context) continue; // Linked, but not in this server or not holding its role.
        journal.markCalled(guildId, pick, now());
        journal.record({ guild: guildId, user: pick, channel: saved.channel, kind: "random" });
        asked = true;
        break; // One question per server per window.
      }
      if (!asked) journal.reschedule(guildId, now()); // Nobody could be asked; look again next window rather than every minute.
    }
  } // Rotate through every LiDollID-verified role member before anyone is asked twice.

  async function runTick() {
    journal.expire(now());
    if (!isSilent(now())) {
      try { await chooseCheck(); }
      catch { console.error("[Diaper check] Could not schedule a check; it will retry."); }
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
