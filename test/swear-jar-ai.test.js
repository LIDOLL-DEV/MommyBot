import assert from "node:assert/strict";
import test from "node:test";
import { generateSwearJarMessage } from "../src/graph/swearJarMessage.js";
import { buildSystemPrompt, SYSTEM_PROMPT } from "../src/graph/prompt.js";

test("swear-jar prose uses the chat AI endpoint and configured persona without sending user data", async () => {
  const calls = [];
  const text = await generateSwearJarMessage("debit", {
    env: { LLAMA_BASE_URL: "http://brain.example:9090/v1/", LLAMA_MODEL: "mommy-model", SYSTEM_PROMPT: "Speak warmly as MommyBot." },
    fetcher: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ choices: [{ message: { content: "<think>hidden reasoning</think>Gentle words, sweetheart! Mommy's swear jar is listening." } }] }) }; },
  });
  assert.equal(text, "Gentle words, sweetheart! Mommy's swear jar is listening.");
  assert.equal(calls[0].url, "http://brain.example:9090/v1/chat/completions");
  const { options } = calls[0], payload = JSON.parse(options.body);
  assert.equal(options.method, "POST"); assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
  assert.equal(payload.model, "mommy-model"); assert.equal(payload.chat_template_kwargs.enable_thinking, false);
  assert.match(payload.messages[0].content, /Speak warmly as MommyBot/);
  assert.match(payload.messages[1].content, /mind their language/);
  assert.match(payload.messages[0].content, /current Discord pronoun-role context/);
  assert.equal(payload.messages.length, 2);
  assert.doesNotMatch(options.body, /discord_id|account_id|guild_id|user_id|bearer/i);
});

test("lottery prose celebrates the winner without asking the AI to calculate or claim a payout", async () => {
  await generateSwearJarMessage("credit", { env: {}, fetcher: async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.messages[1].content, /lottery winner/);
    assert.match(payload.messages[0].content, /Do not claim a payment succeeded or failed/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "A lucky little celebration for you, sweetheart!" } }] }) };
  } });
});

test("missing, incomplete reasoning, oversized and mention-bearing AI text falls back", async t => {
  t.mock.method(console, "error", () => {});
  for (const content of [undefined, "", "<think>private unfinished reasoning", "<think>only reasoning</think>", "@everyone hello", "<@123> hello", "Balance is 999 coins", "https://example.com", "x".repeat(501)]) {
    const result = await generateSwearJarMessage("debit", { env: {}, fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) });
    assert.equal(result, null, String(content));
  }
});

test("HTTP failures, invalid JSON and timeouts return a fallback without leaking provider bodies", async t => {
  const errors = [];
  t.mock.method(console, "error", line => errors.push(line));
  for (const fetcher of [
    async () => ({ ok: false, status: 503, text: async () => "PRIVATE" }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError("PRIVATE"); } }),
    async () => { throw new DOMException("PRIVATE", "TimeoutError"); },
  ]) assert.equal(await generateSwearJarMessage("debit", { env: {}, fetcher }), null);
  assert.ok(errors.some(line => line.includes("HTTP 503")));
  assert.ok(errors.some(line => line.includes("REQUEST_TIMEOUT")));
  assert.ok(errors.every(line => !line.includes("PRIVATE")));
});

test("AI can be paused without contacting the server", async () => {
  assert.equal(await generateSwearJarMessage("debit", { env: { SWEAR_JAR_AI_ENABLED: "false" }, fetcher: async () => assert.fail("AI should be disabled") }), null);
});

test("role-based address overrides legacy gender rules in default and custom personas", () => {
  for (const prompt of [SYSTEM_PROMPT, buildSystemPrompt({}), buildSystemPrompt({ SYSTEM_PROMPT: "Custom persona: call everyone boys." })]) {
    assert.match(prompt, /current Discord pronoun-role context/);
    assert.match(prompt, /He\/Him means he\/him/);
    assert.match(prompt, /Current role context overrides older conversation/);
  }
  assert.ok(buildSystemPrompt({ SYSTEM_PROMPT: "Custom persona." }).startsWith("Custom persona.\n\nMEMBER ADDRESS RULE:"));
});

test("unknown-member swear-jar wording rejects gendered address and accepts neutral wording", async t => {
  t.mock.method(console, "error", () => {});
  const generate = content => generateSwearJarMessage("debit", { env: {}, fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) });
  for (const content of ["Be a good boy!", "Let's be good little boys and girls!", "Mind your words, young man.", "He's our winner!", "A prize for him.", "Congratulations, sir!"]) {
    assert.equal(await generate(content), null, content);
  }
  assert.equal(await generate("Mind your words, sweet girl!"), null);
  assert.equal(await generate("Mind your words, sweetheart!"), "Mind your words, sweetheart!");
});

test("apology acknowledgments and manners reminders use the chat endpoint and distinct persona prompts", async () => {
  for (const kind of ["apology", "reminder"]) {
    const wording = kind === "apology" ? "What sweet manners, darling! Mommy accepts your apology." : "Act your age, sweetheart, and give Mommy a cute little apology.";
    assert.equal(await generateSwearJarMessage(kind, {
      env: { LLAMA_BASE_URL: "http://chat.example/v1", LLAMA_MODEL: "chat-model", ROUTER_LAMA_URL: "http://router.example/v1", ROUTER_MODEL: "classifier", SYSTEM_PROMPT: "Sakura's warm voice." },
      fetcher: async (url, options) => {
        assert.equal(url, "http://chat.example/v1/chat/completions");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "chat-model"); assert.match(body.messages[0].content, /Sakura's warm voice/);
        assert.equal(body.messages.length, 2);
        assert.match(body.messages[1].content, kind === "apology" ? /Do not scold this member again/ : /Include the exact phrase "act your age"/);
        assert.match(body.messages[1].content, /Do not discuss payments, refunds/);
        return { ok: true, json: async () => ({ choices: [{ message: { content: wording } }] }) };
      },
    }), wording);
  }
});

test("apology generation retains fallbacks for disabled AI, failures and unusable reminder text", async t => {
  t.mock.method(console, "error", () => {});
  for (const kind of ["apology", "reminder"]) {
    assert.equal(await generateSwearJarMessage(kind, { env: { SWEAR_JAR_AI_ENABLED: "false" }, fetcher: async () => assert.fail("Disabled") }), null);
    assert.equal(await generateSwearJarMessage(kind, { env: {}, fetcher: async () => { throw new DOMException("PRIVATE", "TimeoutError"); } }), null);
  }
  assert.equal(await generateSwearJarMessage("reminder", { env: {}, fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "Try again, sweet girl." } }] }) }) }), null);
});
