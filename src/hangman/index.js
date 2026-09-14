import { fileURLToPath } from "node:url";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { HangmanStore, HangmanError } from "./store.js";
import { hangmanConfig } from "./words.js";
import { GameSessions } from "../games/sessions.js";
import { createHangmanWeb } from "./web.js";

export function initializeHangman(config, identities, wallet) {
  if (!wallet) return null;
  const game = new HangmanStore(fileURLToPath(new URL("../../data/hangman.db", import.meta.url)), wallet, hangmanConfig());
  const sessions = new GameSessions(game.db, identities, { prefix: "hangman", command: "/hangman", ErrorClass: HangmanError });
  return { sessions, web: createHangmanWeb(config, game, sessions), revoke: user => sessions.revoke(user),
    prune: () => sessions.prune(), close: () => game.close(), ...createHangmanCommands(config, sessions) };
} // Load pending hangman payments before the shared auth listener accepts browser actions.

export function createHangmanCommands(config, sessions) {
  const linkMessage = user => `Open Cozy Hangman: ${config.origin}/hangman/open?ticket=${sessions.begin(user)}\nStart a round for 1 LiDollcoin. Earn 1 coin per newly revealed letter: three matching letters pay 3 coins! You get six wrong guesses and a helpful clue. This private link expires in ten minutes; do not share it.`;
  return {
    linkMessage,
    async registerGuild(guild) {
      try { await guild.commands.create(new SlashCommandBuilder().setName("hangman").setDescription("Open Cozy Hangman: 1 coin to play, 1 coin per revealed letter")); }
      catch { console.error(`[Hangman] Could not register /hangman in guild ${guild.id}.`); }
    },
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== "hangman") return false;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let content;
      try { content = linkMessage(interaction.user.id); }
      catch (error) { content = error instanceof HangmanError ? error.message : "The word garden is unavailable. Try again shortly."; }
      await interaction.editReply({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds }); return true;
    },
    async handleMessage(message) {
      if (message.author.bot || !/^\s*!hangman\s*$/i.test(message.content || "")) return false;
      const reply = content => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
      let content;
      try { content = linkMessage(message.author.id); }
      catch (error) { await reply(error instanceof HangmanError ? error.message : "The word garden is unavailable. Try again shortly."); return true; }
      try { await message.author.send({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds }); }
      catch { await reply("I could not send you a DM. Use /hangman for your private game link."); return true; }
      if (message.guild) await reply("Your private Cozy Hangman link is in your DMs!");
      return true;
    },
  }; // Slash and menu links are private; prefix commands put their handoff in a DM instead of the channel.
}
