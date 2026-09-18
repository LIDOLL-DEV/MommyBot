import { buildSystemPrompt } from "./prompt.js";
import { modelEndpoint, modelFailure } from "./connection.js";
import { pronounInstruction, mismatchedAddress } from "../bot/pronouns.js";

export function welcomeProse(raw, pronouns = "they/them") {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").trim().replace(/^(["'])|(["'])$/g, "").trim();
  if (!text || text.length > 500 || /<|>|```|@|https?:|www\.|\d|\/lidollid|\/menu/i.test(text)) return null;
  if (mismatchedAddress(text, pronouns)) return null;
  return text;
} // Keep reasoning, mentions, links and mismatched address out of greetings; the bot supplies exact onboarding facts.

export async function generateWelcomeMessage({ env = process.env, fetcher = fetch, pronouns = "they/them" } = {}) {
  if (env.WELCOME_AI_ENABLED === "false") return null;
  const requestedTimeout = Number(env.WELCOME_AI_TIMEOUT_MS);
  const timeout = Number.isInteger(requestedTimeout) && requestedTimeout >= 1000 && requestedTimeout <= 15000 ? requestedTimeout : 8000;
  try {
    const base = modelEndpoint("chat", { LLAMA_BASE_URL: env.WELCOME_AI_BASE_URL || "http://192.168.1.250:9090/v1" });
    const response = await fetcher(`${base}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ model: env.LLAMA_MODEL || "default", temperature: 0.8, max_tokens: 192,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: `${buildSystemPrompt(env)}\n${pronounInstruction(pronouns)}\nWrite one or two warm, welcoming sentences for a member who just joined our Discord server. Help this member feel included and gently encourage them to read the rules and complete account registration. Be friendly, never humiliating, sexual or graphic. Output only your greeting without reasoning, quotes, headings or code fences. Do not include names, mentions, links, numbers or commands. The application appends the newcomer mention, exact rules link and LiD0llID registration steps. Never invent server rules or say registration is optional, already complete, or that access has already been granted.` },
          { role: "user", content: "Welcome this new member to our community and encourage them to get settled in. /no_think" },
        ],
      }),
    });
    if (!response.ok) throw Object.assign(new Error("Welcome generation failed"), { status: response.status });
    const data = await response.json();
    const text = welcomeProse(data?.choices?.[0]?.message?.content, pronouns);
    if (!text) throw new Error("Unusable greeting");
    return text;
  } catch (error) {
    console.error(`[Welcome] AI unavailable (${modelFailure(error)}); using the standard welcome.`);
    return null;
  }
} // Use the requested .250 chat endpoint with a bounded wait and no member profiles, identities or chat history in the prompt.
