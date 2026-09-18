import { buildSystemPrompt } from "./prompt.js";
import { modelEndpoint, modelFailure } from "./connection.js";
import { pronounInstruction, mismatchedAddress } from "../bot/pronouns.js";

const MESSAGE_PROMPTS = {
  debit: "Gently remind this member to mind their language and remember Mommy's swear jar.",
  credit: "Congratulate this member as the weekly swear-jar lottery winner with a cheerful little celebration.",
  apology: "This member has given Mommy a proper cute apology after swearing. Warmly accept the apology and praise those sweet manners in Sakura's voice. Do not scold this member again or ask for another apology. Do not discuss payments, refunds or rewards.",
  reminder: 'This member swore and then skipped the apology or gave one that was too formal or casual. Gently chastise this member in Sakura\'s playful Mommy voice and ask for a cute apology. Include the exact phrase "act your age" without inventing a numeric age. Be affectionate, never insulting. The application appends the accepted apology examples, so do not list them yourself. Do not discuss payments, refunds or extra penalties.',
}; // Choose wording from the saved notice type, without sending a member's message or account details to the chat model.

export async function generateSwearJarMessage(kind, { env = process.env, fetcher = fetch, pronouns = "they/them" } = {}) {
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
          { role: "user", content: `${pronounInstruction(pronouns)}\n${MESSAGE_PROMPTS[kind] ?? MESSAGE_PROMPTS.debit} /no_think` },
        ],
      }),
    });
    if (!response.ok) throw Object.assign(new Error("Swear jar generation failed"), { status: response.status });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("No message text");
    const text = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").trim().replace(/^(["'])|(["'])$/g, "").trim();
    if (!text || text.length > 500 || /<\/?think\b|```|@|https?:|\d|\/lidollid/i.test(text)) throw new Error("Unusable message text");
    if (kind === "reminder" && !/\bact your age\b/i.test(text)) throw new Error("Missing manners reminder"); // Preserve the requested correction even if the model omits it.
    if (mismatchedAddress(text, pronouns)) {
      throw new Error("Incorrect member address");
    } // Reject address that conflicts with this recipient's role; the factual fallback is gender-neutral.
    return text;
  } catch (error) {
    console.error(`[Swear jar] AI message unavailable (${modelFailure(error)}); using the notice's standard message.`);
    return null;
  }
} // Generate only the friendly wording; never send chat history or wallet identities, and always permit a timely factual fallback.
