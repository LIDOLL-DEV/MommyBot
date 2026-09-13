import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { WalletError } from "./client.js";
import { TraderError } from "../touhou/store.js";

export const balanceText = balance => `Little Log wallet: **${balance.stars} stars** and **${balance.coins} LiDollcoins**.\nAdoption costs **1 star OR 25 LiDollcoins**. Market, items and battle rewards use separate local coins.`;

export async function handleWalletInteraction(interaction, wallet, identities) {
  const button = interaction.customId?.startsWith("lw:finish:");
  const command = interaction.isChatInputCommand() && interaction.commandName === "lidollid" && interaction.options.getSubcommandGroup?.() === "wallet";
  if (!button && !command) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let response;
  try {
    if (!wallet) throw new WalletError("disabled", "Online wallets are not enabled yet. Ask Doll to configure the Little Log wallet app.");
    const user = interaction.user.id;
    if (button) {
      const [, , owner, generation] = interaction.customId.split(":");
      if (owner !== user) throw new WalletError("wrong_user", "Start your own connection with /lidollid wallet connect.");
      if (!identities.get(user)) throw new WalletError("not_linked", "Use /lidollid login and confirm your identity before connecting a wallet.");
      response = { content: `Wallet connected!\n${balanceText(await wallet.finish(user, generation))}` };
    } else switch (interaction.options.getSubcommand()) {
      case "connect": {
        if (!identities.get(user)) throw new WalletError("not_linked", "Use /lidollid login and confirm your identity first, then /lidollid wallet connect.");
        const approval = await wallet.begin(user);
        response = { content: `Open ${approval.verificationUri}\nEnter your private code: **${approval.userCode}**\nApprove LiDollBot to read and spend stars and LiDollcoins, then press Check approval. Use your own Little Log account; its wallet will fund adoptions. The code expires in 10 minutes.`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`lw:finish:${user}:${approval.generation}`).setLabel("Check approval").setStyle(ButtonStyle.Primary))] };
        break;
      }
      case "balance": response = { content: balanceText(await wallet.balance(user)) }; break;
      case "disconnect": await wallet.disconnect(user); response = { content: "Your wallet connection was revoked and removed. Your balances remain in Little Log." }; break;
      case "retry": {
        if (!wallet.adoptions) throw new WalletError("disabled", "Enable Touhou Trader to finish pending adoptions.");
        const result = await wallet.adoptions.retry(user);
        response = { content: `Adopted **${result.character.name}** in server ${result.character.guild_id} for **${result.price} ${result.currency === "stars" ? "star" : "LiDollcoins"}**. Check /touhou collection there.` };
        break;
      }
      default: throw new WalletError("unknown", "Use /lidollid wallet connect or balance.");
    }
  } catch (error) {
    response = { content: error instanceof WalletError || error instanceof TraderError ? error.message : "Wallet storage is unavailable. Try again; pending payments are saved for /lidollid wallet retry." };
  }
  await interaction.editReply({ ...response, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
  return true;
} // Use authenticated Discord IDs and private replies for approval codes, account balances and recovery.
