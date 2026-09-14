import { buildSystemPrompt } from "./prompt.js";
import { modelEndpoint, modelFailure } from "./connection.js";

export async function generateSwearJarMessage(kind, { env = process.env, fetcher = fetch } = {}) {
  if (env.SWEAR_JAR_AI_ENABLED === "false") return null;
  const requestedTimeout = Number(env.SWEAR_JAR_AI_TIMEOUT_MS);
  const timeout = Number.isInteger(requestedTimeout) && requestedTimeout >= 1000 && requestedTimeout <= 15000 ? requestedTimeout : 8000;
  try {
    const response = await fetcher(`${modelEndpoint("chat", env)}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({
        model: env.LLAMA_MODEL || "default", temperature: 0.8, max_tokens: 192,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: `${buildSystemPrompt(env)}\nYou are writing a short MommyBot swear-jar notification. Write one or two warm, playful sentences in your established voice. Be gently encouraging, never humiliating. Output only the message, without reasoning, quotes, headings or code fences. The application appends the exact payment status, account instructions, winner mention and current jar balance. Do not include numbers, balances, payment claims, commands, links, mentions or account details. Do not claim a payment succeeded or failed. Do not use swear words.` },
          { role: "user", content: kind === "credit" ? "Congratulate the girl who is the weekly swear-jar lottery winner with a cheerful little celebration. /no_think" : "Gently remind a girl who swore to mind her language and remember Mommy's swear jar. /no_think" },
        ],
      }),
    });
    if (!response.ok) throw Object.assign(new Error("Swear jar generation failed"), { status: response.status });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("No message text");
    const text = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").trim().replace(/^(["'])|(["'])$/g, "").trim();
    if (!text || text.length > 500 || /<\/?think\b|```|@|https?:|\d|\/lidollid/i.test(text)) throw new Error("Unusable message text");
    if (/\b(?:boys?|men|man|guys?|dudes?|sons?|sir|mister|mr|gentlem[ae]n|lads?|bros?|brothers?|prince|king|male|he|him|his|himself)\b/i.test(text)) {
      throw new Error("Incorrect member address");
    } // Reject masculine wording in these short member-directed notices and let the feminine factual fallback send instead.
    return text;
  } catch (error) {
    console.error(`[Swear jar] AI message unavailable (${modelFailure(error)}); using the saved payment's standard message.`);
    return null;
  }
} // Generate only the friendly wording; never send chat history or wallet identities, and always permit a timely factual fallback.
