import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { buildGraph } from "../../graph/graph.js";
import { conversationContext } from "../conversation.js";
import { addressedByName } from "../../graph/router.js";

export function createMessageHandler({ getGraph, contextReader = conversationContext, logger = console }) {
  const queues = new Map();
  async function processMessage(message, botId) {
    let direct = Boolean(message.mentions?.users?.has(botId)) || !message.guildId || addressedByName(message.content);
    let sendAttempted = false;
    try {
      const routing = await contextReader(message, botId);
      direct ||= routing.replyTo === "sakura";
      const graph = await getGraph();
      const result = await graph.invoke({ messages: [new HumanMessage(message.content)], force_respond: direct, routing_context: routing }, {
        configurable: { thread_id: message.author.id },
      }); // Keep durable per-member memory, but supply fresh channel context for every routing decision.
      const finalMessage = result.messages?.at(-1);
      if (result.next !== "sakura_llm" || !(finalMessage instanceof AIMessage)) return false;
      const content = typeof finalMessage.content === "string" ? finalMessage.content : "";
      const cleaned = content.replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, "")
        .replace(/<thinking[^>]*>[\s\S]*?<\/thinking[^>]*>/gi, "")
        .replace(/```thinking```[\s\S]*?```\/thinking```/gi, "")
        .replace(/\u3010(?:think|thinking)\u3011[\s\S]*?\u3010\/(?:think|thinking)\u3011/gi, "").trim();
      if (!cleaned || cleaned === message.content.trim()) return false;
      sendAttempted = true;
      await message.channel.send(`${message.author} ${cleaned}`);
      return true;
    } catch (error) {
      logger.error("[Chat] Conversation turn failed:", error.message);
      if (direct && !sendAttempted) {
        try { await message.channel.send("Sakura couldn't finish that reply. Please try again."); }
        catch { logger.error("[Chat] Could not deliver the retry notice."); }
      }
      return false;
    }
  } // Only a newly generated assistant turn may be sent; skipping cannot accidentally echo a cleaned user message.

  return async (message, botId) => {
    if (message.author.bot || message.author.id === botId || !message.content?.trim()) return false;
    const key = message.author.id, previous = queues.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => processMessage(message, botId));
    queues.set(key, task);
    try { return await task; }
    finally { if (queues.get(key) === task) queues.delete(key); }
  }; // Serialize each member's turns so quick follow-ups cannot overwrite the same conversation checkpoint.
}

let defaultHandler;
export async function handleMessage(message, botId) {
  if (!defaultHandler) defaultHandler = createMessageHandler({ getGraph: async () => {
    const { checkpointer } = await import("../../db/checkpointer.js");
    return buildGraph(checkpointer);
  } });
  return defaultHandler(message, botId);
} // Load the live database only for the real handler; isolated tests use disposable graphs and fake Discord channels.
