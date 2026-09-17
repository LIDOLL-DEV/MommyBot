import { fileURLToPath } from "node:url";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { GoFishStore, GoFishError } from "./store.js";
import { goFishConfig } from "./rules.js";
import { GameSessions } from "../games/sessions.js";
import { createGoFishWeb } from "./web.js";

export function initializeGoFish(config, identities, wallet) {
  if (!wallet) return null;
  const game = new GoFishStore(fileURLToPath(new URL("../../data/gofish.db", import.meta.url)), wallet, goFishConfig());
  const sessions = new GameSessions(game.db, identities, { prefix: "gofish", command: "/gofish", ErrorClass: GoFishError });
  return { sessions, game, web: createGoFishWeb(config, game, sessions), revoke: user => sessions.revoke(user),
    prune: () => { sessions.prune(); game.prune(); }, close: () => game.close(), ...createGoFishCommands(config, sessions, game, identities) };
} // Load pending Go Fish payments and retire stale invites before the shared auth listener accepts browser actions.

export function createGoFishCommands(config, sessions, game, identities) {
  const linkMessage = user => `Open Go Fish: ${config.origin}/gofish/open?ticket=${sessions.begin(user)}\nPlay the computer for 1 LiDollcoin and earn 1 coin per book of four. Games against a friend are free: share an invite code, use \`/gofish friend:@name\`, or join an open table. This private link expires in ten minutes; do not share it.`;
  return {
    linkMessage,
    async registerGuild(guild) {
      try {
        await guild.commands.create(new SlashCommandBuilder().setName("gofish").setDescription("Open Go Fish: 1 coin against the computer, free against a friend")
          .addUserOption(option => option.setName("friend").setDescription("Challenge this member to a free game").setRequired(false)));
      } catch { console.error(`[GoFish] Could not register /gofish in guild ${guild.id}.`); }
    },
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== "gofish") return false;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const target = interaction.options.getUser?.("friend") ?? null;
      let content;
      try { content = target ? await challenge(interaction, target) : linkMessage(interaction.user.id); }
      catch (error) { content = error instanceof GoFishError ? error.message : "The card pond is unavailable. Try again shortly."; }
      await interaction.editReply({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds }); return true;
    },
    async handleMessage(message) {
      if (message.author.bot || !/^\s*!gofish\s*$/i.test(message.content || "")) return false;
      const reply = content => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
      let content;
      try { content = linkMessage(message.author.id); }
      catch (error) { await reply(error instanceof GoFishError ? error.message : "The card pond is unavailable. Try again shortly."); return true; }
      try { await message.author.send({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds }); }
      catch { await reply("I could not send you a DM. Use /gofish for your private game link."); return true; }
      if (message.guild) await reply("Your private Go Fish link is in your DMs!");
      return true;
    },
  }; // Slash and menu links are private; prefix commands put their handoff in a DM instead of the channel.

  async function challenge(interaction, target) {
    if (target.bot) throw new GoFishError("Bots do not play cards. Challenge a member, or play the computer with /gofish.");
    if (target.id === interaction.user.id) throw new GoFishError("Challenge a friend, not yourself. Use /gofish to play the computer.");
    if (!identities.get(target.id)) throw new GoFishError("That member needs to finish /lidollid login before they can be challenged.");
    const { code } = game.challenge(interaction.user.id, target.id, interaction.user.username);
    const invite = `${config.origin}/gofish/open?ticket=${sessions.begin(target.id)}&code=${code}`;
    try {
      await target.send({ content: `${interaction.user.username} challenged you to a free game of Go Fish!\nOpen your private table: ${invite}\nThis challenge expires in ten minutes. No coins are spent in a friend game.`,
        allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
    } catch {
      return `Your table is waiting, but I could not DM that member. Give them this invite code yourself: **${code}**\nThey can enter it on ${config.origin}/gofish/ within ten minutes.`;
    }
    return `Challenge sent! ${target.username} has ten minutes to open their private table. Your invite code is **${code}** if you would rather pass it along yourself.\nOpen your own table: ${config.origin}/gofish/open?ticket=${sessions.begin(interaction.user.id)}`;
  } // The invited player receives their own signed handoff; the code alone never reveals another member's session.
}
