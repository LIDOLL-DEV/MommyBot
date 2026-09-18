import { Client, GatewayIntentBits, Partials } from "discord.js";

/**
 * Initialize the Discord Client
 */
export function createClient(env = process.env) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      ...(env.WELCOME_ENABLED === "false" ? [] : [GatewayIntentBits.GuildMembers]), // Join welcomes require Server Members Intent enabled in Discord's developer portal.
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageTyping,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User], // Receive reaction events for older messages after a restart.
  });

  return client;
}
