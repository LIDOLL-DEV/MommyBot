import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { WalletError } from "./client.js";
import { TraderError } from "../touhou/store.js";
import { canAward } from "../permissions.js";
import { HangmanError } from "../hangman/store.js";
import { BallDropError } from "../balldrop/rules.js";
import { swearJarPaymentText, swearJarBalanceText } from "./swearJar.js";

export const balanceText = balance => `Little Log wallet: **${balance.stars} stars** and **${balance.coins} LiDollcoins**. Diamonds: **${balance.diamonds??'reconnect to enable'}**.\nExchange diamonds for coins on Little Log's Stickers page (1 diamond = 50 coins).\nAdoption costs **1 star OR 25 LiDollcoins**. All other trader payments and rewards use these LiDollcoins.`;
const giftText = gift => `Gift completed: **${gift.amount} ${gift.asset === "diamonds" ? "diamonds" : gift.asset === "stars" ? "stars" : "LiDollcoins"}** credited to <@${gift.user_id}>'s online wallet. They can check /lidollid wallet balance.`; // Confirm the gift without revealing the recipient's total balance.

const transferText = job => job.state === "refunded"
  ? `Transfer could not be delivered. **${job.amount} ${job.asset === "diamonds" ? "diamonds" : "LiDollcoins"}** was refunded to <@${job.sender_id}>. The recipient received nothing.`
  : `Transfer completed: **${job.amount} ${job.asset === "diamonds" ? "diamonds" : "LiDollcoins"}** sent from <@${job.sender_id}> to <@${job.recipient_id}>.`; // Report the transfer amount without disclosing either wallet's total balance.

export async function handleWalletInteraction(interaction, wallet, identities) {
  const button = interaction.customId?.startsWith("lw:finish:");
  const command = interaction.isChatInputCommand() && interaction.commandName === "lidollid" && interaction.options.getSubcommandGroup?.() === "wallet";
  if (!button && !command) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const response = await runWalletAction(interaction, wallet, identities, button ? "legacy-finish" : interaction.options.getSubcommand());
  await interaction.editReply({ ...response, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
  return true;
} // Keep Discord acknowledgement separate so private menus can reuse the same authorization and payments.

export async function runWalletAction(interaction, wallet, identities, action, options = interaction.options) {
  let response;
  try {
    if (!wallet) throw new WalletError("disabled", "Online wallets are not enabled yet. Ask Doll to configure the Little Log wallet app.");
    const user = interaction.user.id;
    if (action === "legacy-finish" && wallet.identityFor) throw new WalletError("expired_token", "Use /lidollid login to connect your account and wallet together.");
    if (action === "legacy-finish") {
      const [, , owner, generation] = interaction.customId.split(":");
      if (owner !== user) throw new WalletError("wrong_user", "Start your own connection with /lidollid wallet connect.");
      if (!identities.get(user)) throw new WalletError("not_linked", "Use /lidollid login and confirm your identity before connecting a wallet.");
      response = { content: `Wallet connected!\n${balanceText(await wallet.finish(user, generation))}` };
    } else switch (action) {
      case "send": {
        const target = options.getUser("user", true);
        if (!interaction.guildId || interaction.user.bot || !target || target.bot || target.id === user) {
          throw new WalletError("invalid_transfer", "Choose another person in a server to receive coins or diamonds.");
        }
        if (!identities.get(user) || !identities.get(target.id)) {
          throw new WalletError("not_linked", "Both players need to finish /lidollid login and connect their wallets first.");
        }
        response = { content: transferText(await wallet.transfers.send(interaction.guildId, user, target.id,
          options.getString("currency", true), options.getInteger("amount", true), interaction.id)) };
        break;
      }
      case "gift":
      case "gift-retry": {
        if (!interaction.guildId || !canAward(interaction, process.env.TOUHOU_ADMIN_ROLE_ID || "")) {
          throw new WalletError("forbidden", "You need Manage Server or the configured trader admin role to gift currency in a server.");
        }
        const target = options.getUser("user", true);
        if (target.bot) throw new WalletError("invalid_gift", "Choose a person, not a bot, to receive this gift.");
        const retry = action === "gift-retry";
        if (!retry && !identities.get(target.id)) throw new WalletError("not_linked", "The recipient needs to finish /lidollid login and connect their wallet first.");
        const gift = retry ? await wallet.gifts.retry(target.id, interaction.guildId) :
          await wallet.gifts.gift(interaction.guildId, user, target.id, options.getString("currency", true), options.getInteger("amount", true), interaction.id);
        response = { content: giftText(gift) };
        break;
      }
      case "connect": {
        if (!identities.get(user)) throw new WalletError("not_linked", "Use /lidollid login and confirm your identity first, then /lidollid wallet connect.");
        const approval = await wallet.begin(user);
        response = { content: `Open ${approval.verificationUri}\nEnter your private code: **${approval.userCode}**\nApprove LiDollBot to read, earn and spend stars, diamonds and LiDollcoins, then press Check approval. Use your own Little Log account; its wallet will fund adoptions. The code expires in 10 minutes.`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`lw:finish:${user}:${approval.generation}`).setLabel("Check approval").setStyle(ButtonStyle.Primary))] };
        break;
      }
      case "balance": response = { content: balanceText(await wallet.balance(user)) }; break;
      case "disconnect": await wallet.disconnect(user); response = { content: "Your wallet connection was revoked and removed. Your balances remain in Little Log." }; break;
      case "retry": {
        if (wallet.transfers?.pending(user)) {
          response = { content: transferText(await wallet.transfers.retry(user)) };
          break;
        }
        if (wallet.swearJar?.pending(user)) {
          const job = wallet.swearJar.pending(user);
          let content;
          try { content = swearJarPaymentText(await wallet.swearJar.retry(user)); }
          catch (error) { if (!(error instanceof WalletError)) throw error; content = error.message; }
          response = { content: `${content}\n\n${swearJarBalanceText(wallet.swearJar.balance(job.guild_id))}` };
          break;
        }
        if (wallet.hangman?.pending(user)) {
          const result = await wallet.hangman.retry(user);
          response = { content: result.action === "start" ? "Your hangman entry is paid. Use /hangman to continue the same word." : `Your ${result.amount}-coin hangman letter reward is paid. Use /hangman to continue.` };
          break;
        }
        if (wallet.balldrop?.pending(user)) {
          const result = await wallet.balldrop.retry(user);
          response = { content: `Your ball drop is settled. Pocket ${result.round.landing}; ${result.round.payout} LiDollcoins returned on your ${result.round.bet}-coin bet. Use /balldrop to view it.` };
          break;
        }
        if (wallet.gifts?.pending(user)) {
          response = { content: giftText(await wallet.gifts.retry(user)) };
          break;
        }
        if (wallet.gacha?.pending(user)) {
          const result = await wallet.gacha.retry(user);
          response = { content: `Diaper ${result.action} completed for ${result.amount} LiDollcoins. Use /diapers to see your collection and bank.` };
          break;
        }
        if (!wallet.adoptions) throw new WalletError("disabled", "Enable Touhou Trader to finish pending adoptions.");
        if (!wallet.adoptions.pending(user) && wallet.economy) { response = await wallet.economy.retry(user); break; }
        const result = await wallet.adoptions.retry(user);
        response = { content: `Adopted **${result.character.name}** in server ${result.character.guild_id} for **${result.price} ${result.currency === "stars" ? "star" : "LiDollcoins"}**. Check /touhou collection there.` };
        break;
      }
      default: throw new WalletError("unknown", "Use /lidollid wallet connect or balance.");
    }
  } catch (error) {
    response = { content: error instanceof WalletError || error instanceof TraderError || error instanceof HangmanError || error instanceof BallDropError ? error.message : "Wallet storage is unavailable. Try again; pending payments are saved for /lidollid wallet retry." };
  }
  return response;
} // Use authenticated Discord IDs and private replies for approval codes, account balances and recovery.
