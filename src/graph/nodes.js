import { HumanMessage, AIMessage } from "@langchain/core/messages";
import process from "process";
import { SYSTEM_PROMPT } from "./prompt.js";
import { completionText } from "./completion.js";

/**
 * Router Node
 * Decides whether Sakura should respond to a message.
 * - If the user @pinged Sakura, always respond.
 * - Otherwise, ask a lightweight LLM call to classify the message.
 */
export async function routerNode(state) {
  console.log("🌸 [ROUTER] Evaluating message...");
  console.log(`   force_respond: ${state.force_respond}`);
  console.log(`   Total messages in state: ${state.messages.length}`);

  // Always respond when directly pinged
  if (state.force_respond) {
    console.log("🌸 [ROUTER] Decision: User pinged Sakura → Responding!");
    return { next: "sakura_llm" };
  }

  // Lightweight classification: should Sakura chime in?
  const lastMessage = state.messages[state.messages.length - 1];
  const userText = lastMessage?.content || "";

  try {
    const decision = await shouldRespond(userText);
    console.log(`🌸 [ROUTER] Decision: ${decision}`);
    return { next: decision };
  } catch (error) {
    console.error("🌸 [ROUTER] ❌ Classification failed, defaulting to skip:", error.message);
    return { next: "__end__" };
  }
}

/**
 * Lightweight LLM call to decide if Sakura should respond.
 * Returns "sakura_llm" to respond, or "__end__" to skip.
 */
async function shouldRespond(userMessage) {
  const baseUrl = process.env.ROUTER_LAMA_URL || "http://192.168.1.250:9091/v1";
  const model = process.env.LLAMA_MODEL || "default";

  const payload = {
    model: model,
    messages: [
      {
        role: "system",
        content: `You are an intelligent router for "Sakura," a nurturing ABDL Mommy Discord bot. Your job is to decide if Sakura should respond to the user's latest message in the chat.

RULES FOR RESPONDING:
- ALWAYS respond if the message contains the word "Sakura" or addresses the bot by name (with or without @).
- ALWAYS respond to direct questions, statements directed at Sakura, or conversational replies.
- ALWAYS respond to emotional expressions, baby/little talk, or messages inviting interaction/comfort.
- ALWAYS respond if the message is part of an ongoing conversation with Sakura.

RULES FOR SKIPPING:
- SKIP if it's spam, random links, or gibberish.
- SKIP if it's a command meant for another bot or system (e.g., "!play", "!skip", "!stats").
- SKIP if it's a simple, non-interactive statement with no clear conversational hook (e.g., "lol", "brb", "nice pic").
- SKIP if the message is clearly part of a side conversation Sakura wasn't involved in and doesn't mention her.

Respond with ONLY one word: "respond" or "skip". Do not add punctuation or explanations.`
      },
      {
        role: "user",
        content: `Message to evaluate: "${userMessage}"`
      }
    ],
    temperature: 0.2,
    max_tokens: 10,
    stop: ["\n", " ", "\t"]
  };

  try {
    console.log(`🌸 [ROUTER] Fetching classification from ${baseUrl}...`);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`🌸 [ROUTER] ❌ Router HTTP ${response.status}: ${await response.text()}`);
      throw new Error(`Router HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "";
    console.log(`🌸 [ROUTER] 📝 Raw model output: "${rawContent.trim()}"`);
    
    const decision = rawContent.trim().toLowerCase();

    if (decision.startsWith("respond")) return "sakura_llm";
    if (decision.startsWith("skip")) return "__end__";
    
    // Fallback to responding if output is unclear
    console.log(`🌸 [ROUTER] ⚠️ Unclear output, defaulting to respond.`);
    return "sakura_llm";

  } catch (err) {
    console.error(`🌸 [ROUTER] ❌ Fetch failed: ${err.message}. Defaulting to respond.`);
    return "sakura_llm";
  }
}

/**
 * Sakura LLM Node
 * Uses a direct fetch() call to guarantee network activity.
 */
export async function sakuraLLMNode(state) {
  console.log("🌸 [LLM NODE] Starting execution! (This means routing works!)");
  
  const baseUrl = process.env.LLAMA_BASE_URL || "http://192.168.1.250:9090/v1";
  const model = process.env.LLAMA_MODEL || "default";
  
  const systemMsg = { role: "system", content: SYSTEM_PROMPT };
  const conversationHistory = state.messages.map(m => ({
    role: m instanceof HumanMessage ? 'user' : 'assistant',
    content: m.content
  }));

  const payload = {
    model: model,
    messages: [systemMsg, ...conversationHistory],
    temperature: 0.7,
    max_tokens: 10000,
    stop: ["\nUser", "\nHuman", "User:", "Human:"]
  };

  console.log(`📤 [LLM NODE] POSTing to ${baseUrl}/chat/completions`);

  try {
    // Direct fetch to Llama.cpp OpenAI-compatible endpoint
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = completionText(data); // Empty answer text is an error even when the HTTP request succeeded.

    console.log(`📥 [LLM NODE] ✅ Response received!`);
    console.log(`   📝 Content: "${content}"`);

    // 🛡️ Echo Guard: If LLM just repeats the user's exact words
    const lastUserMsg = state.messages[state.messages.length - 1];
    if (content === lastUserMsg.content || 
        (content.length < 30 && content.includes(lastUserMsg.content.substring(0, 10)))) {
      
      console.log("🌸 [ECHO GUARD] ⚠️ Model repeated! Using fallback.");
      return { messages: [new AIMessage("Sweetheart, I'm listening! Tell Mommy more~ 💕")] };
    }

    // ✅ Valid original response
    return { messages: [new AIMessage(content)] };

  } catch (error) {
    console.error(`🌸 [LLM NODE] ❌ Fetch failed:`, error.message);
    if (error.code === "EMPTY_MODEL_RESPONSE") {
      return { messages: [new AIMessage("Sakura's model returned no answer text. Please try again. 💕")] }; // Give an accurate retry message without posting reasoning-only output.
    }
    return { messages: [new AIMessage("Oops! Sakura couldn't reach her brain right now. 💕")] };
  }
}
