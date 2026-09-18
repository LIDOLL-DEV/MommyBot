import { HumanMessage, AIMessage } from "@langchain/core/messages";
import process from "process";
import { SYSTEM_PROMPT } from "./prompt.js";
import { completionText } from "./completion.js";
import { modelEndpoint, modelFailure } from "./connection.js";
import { decideResponse } from "./router.js";
import { pronounInstruction } from "../bot/pronouns.js";

export async function routerNode(state) {
  const decision = await decideResponse(state);
  console.log(`[Router] ${decision.next}: ${decision.routing_reason}`);
  return decision;
} // Keep the graph route and its diagnostic reason together without logging private classifier output.

/**
 * Sakura LLM Node
 * Uses a direct fetch() call to guarantee network activity.
 */
export async function sakuraLLMNode(state) {
  console.log("🌸 [LLM NODE] Starting execution! (This means routing works!)");
  
  let baseUrl = "invalid configuration";
  const model = process.env.LLAMA_MODEL || "default";
  
  const systemMsg = { role: "system", content: `${SYSTEM_PROMPT}\n\nCURRENT MEMBER: ${pronounInstruction(state.member_pronouns)} Other members have unknown pronouns unless their own role context is supplied; use neutral wording for them.` };
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

  try {
    baseUrl = modelEndpoint("chat");
    console.log(`📤 [LLM NODE] POSTing to ${baseUrl}/chat/completions`);
    // Direct fetch to Llama.cpp OpenAI-compatible endpoint
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(300000), // Bound stalled requests while allowing the configured long answers time to generate.
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw Object.assign(new Error("Model request failed"), { status: response.status });
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
    console.error(`[Brain] Chat request to ${baseUrl} failed (${modelFailure(error)}). Check LLAMA_BASE_URL and the model server's network access.`);
    if (error.code === "EMPTY_MODEL_RESPONSE") {
      return { messages: [new AIMessage("Sakura's model returned no answer text. Please try again. 💕")] }; // Give an accurate retry message without posting reasoning-only output.
    }
    return { messages: [new AIMessage("Oops! Sakura couldn't reach her brain right now. 💕")] };
  }
}
