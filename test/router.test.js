import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { decideResponse, addressedByName, closesConversation, parseRouterDecision } from "../src/graph/router.js";
import { conversationContext } from "../src/bot/conversation.js";
import { createMessageHandler } from "../src/bot/handlers/message.js";
import { buildGraph } from "../src/graph/graph.js";
import { ConversationSqliteSaver } from "../src/db/sqliteSaver.js";

const logger = { log() {}, warn() {}, error() {} };
const state = (text, routing_context = {}, force_respond = false) => ({ messages: [new HumanMessage(text)], routing_context, force_respond });
const recent = [
  { speaker: "current_member", text: "I need a hand.", ageSeconds: 25, mentions: [] },
  { speaker: "sakura", text: "Would you like a suggestion?", ageSeconds: 10, mentions: ["current_member"] },
];
const forbiddenFetch = () => { throw Error("This decision must not call a model"); };

test("mentions, replies without pings, DMs and direct names bypass classification", async () => {
  for (const input of [state("hi", {}, true), state("hi", { directMention: true }), state("tell me more", { replyTo: "sakura" }), state("hi", { isDM: true }), state("Sakura, can you help?"), state("hey Sakura!"), state("Sakura can you help?")]) {
    const result = await decideResponse(input, { fetcher: forbiddenFetch, logger });
    assert.equal(result.next, "sakura_llm"); assert.equal(result.routing_reason, "direct_address");
  }
  for (const text of ["Sakura is lovely", "Sakura said that yesterday", "I asked Sakura", '"Sakura, answer"', "sakuracake", "Sakura did that yesterday"]) assert.equal(addressedByName(text), false);
});

test("side conversations, commands, link dumps and closing acknowledgements stay quiet", async () => {
  for (const input of [state("Can you help me?", { replyTo: "other_member_1" }), state("Are you coming?", { mentions: ["other_member_1"] }), state("!play music", {}, true), state("/stats"), state("https://example.org"), state("thanks lol", { recent }), state("brb"), state("okay")]) {
    const result = await decideResponse(input, { fetcher: forbiddenFetch, logger });
    assert.equal(result.next, "__end__"); assert.notEqual(result.routing_reason, "router_unavailable");
  }
  assert.equal((await decideResponse(state("Sakura, help us", { replyTo: "other_member_1" }), { fetcher: forbiddenFetch, logger })).next, "sakura_llm");
});

test("short answers continue a recent question only for its intended participant", async () => {
  assert.equal((await decideResponse(state("yes please", { recent }), { fetcher: forbiddenFetch, logger })).routing_reason, "answer_to_recent_question");
  for (const history of [recent.map(item => ({ ...item, ageSeconds: 900 })), [recent[0], { ...recent[1], mentions: ["other_member_1"] }], [...recent, { speaker: "other_member_1", text: "Something else", ageSeconds: 5 }], []]) {
    let calls = 0;
    const result = await decideResponse(state("yes please", { recent: history }), { logger, fetcher: async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: "skip" } }] }) }; } });
    assert.equal(calls, 1); assert.equal(result.next, "__end__");
  }
});

test("finished thanks end the turn but gratitude with a new request or concern does not", () => {
  for (const text of ["Thanks so much!", "That helped, thank you so much!", "I'll give that a try, thanks!", "I appreciate it", "Got it, thanks", "That makes sense. Thank you again."]) assert.equal(closesConversation(text), true, text);
  for (const text of ["Thanks, but could you explain that again?", "Thanks, I'm still feeling overwhelmed", "It worked?", "thanks?", "thank you, I don't feel safe", "Thanks, I tried that already"]) assert.equal(closesConversation(text), false, text);
});

test("an active exchange between humans needs a direct or open invitation to include the bot", async () => {
  const history = [{ speaker: "other_member_1", text: "I installed that game", ageSeconds: 15 }, { speaker: "current_member", text: "I have it too", ageSeconds: 5 }];
  assert.equal((await decideResponse(state("Want to play with me?", { recent: history }), { logger, fetcher: forbiddenFetch })).routing_reason, "active_human_exchange");
  assert.equal((await decideResponse(state("Sakura, join us?", { recent: history }), { logger, fetcher: forbiddenFetch })).next, "sakura_llm");
  for (const [text, recent] of [["Can anyone help us?", history], ["What shall we do?", history.map(turn => ({ ...turn, ageSeconds: 900 }))]]) {
    let calls = 0;
    await decideResponse(state(text, { recent }), { logger, fetcher: async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: "respond" } }] }) }; } });
    assert.equal(calls, 1);
  }
});

test("classifier sees bounded channel context and complete output without whitespace stop tokens", async () => {
  let payload;
  const result = await decideResponse(state("Work was rough", { recent: Array.from({ length: 15 }, () => recent[1]) }), {
    env: { ROUTER_LAMA_URL: "http://router.example/v1", ROUTER_MODEL: "small-router" }, logger,
    fetcher: async (url, options) => {
      assert.equal(url, "http://router.example/v1/chat/completions"); assert.ok(options.signal);
      payload = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: "respond\n" } }] }) };
    },
  });
  assert.equal(result.next, "sakura_llm"); assert.equal(result.routing_context, null);
  assert.equal(payload.model, "small-router"); assert.equal(payload.temperature, 0); assert.ok(payload.max_tokens >= 32);
  assert.equal(payload.stop, undefined); assert.equal(payload.chat_template_kwargs.enable_thinking, false);
  const data = JSON.parse(payload.messages[1].content);
  assert.equal(data.recent.length, 12); assert.equal(data.latest.text, "Work was rough");
  assert.match(payload.messages[0].content, /Let conversations end/);
});

test("blank, reasoning-only, malformed and failed router output never forces a reply", async () => {
  for (const raw of [null, undefined, "", " ", "respond because it is emotional", "<think>respond", "<think>respond</think>", "skip or respond", "{\"decision\":\"respond\"}"]) {
    assert.equal(parseRouterDecision(raw), null);
    const result = await decideResponse(state("a topic in chat"), { logger, fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: raw, reasoning_content: "respond" } }] }) }) });
    assert.equal(result.next, "__end__"); assert.equal(result.routing_reason, "invalid_decision");
  }
  for (const fetcher of [async () => { throw Error("offline"); }, async () => { throw new DOMException("timeout", "TimeoutError"); }, async () => ({ ok: false, status: 503 }), async () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } })]) {
    const result = await decideResponse(state("a topic in chat"), { logger, fetcher });
    assert.equal(result.next, "__end__"); assert.equal(result.routing_reason, "router_unavailable");
  }
  assert.equal(parseRouterDecision(" Respond. \n"), "respond"); assert.equal(parseRouterDecision("<think>private</think>skip"), "skip");
});

function message(text = "yes please", extra = {}) {
  return { id: "latest", content: text, channelId: "channel", guildId: "guild", createdTimestamp: 1_000_000,
    author: { id: "alice", bot: false, toString: () => "<@alice>" }, mentions: { users: new Map() },
    channel: { id: "channel", messages: { cache: new Map(), fetch: async () => new Map() }, send: async () => {} }, ...extra };
} // Use synthetic Discord messages; tests never connect to Discord or touch the live conversation database.

test("history is chronological, fresh, channel-local and labels replies to the bot without a mention", async () => {
  const incoming = message(), rows = [
    message("Want some help?", { id: "bot", author: { id: "sakura-id", bot: true }, createdTimestamp: 999_000 }),
    message("I need help", { id: "before", createdTimestamp: 998_000 }),
    message("Wrong channel", { id: "wrong", channelId: "private", createdTimestamp: 998_000 }),
    message("Old chat", { id: "old", createdTimestamp: 1 }),
    message("Future", { id: "future", createdTimestamp: 1_000_001 }), incoming,
  ];
  incoming.reference = { messageId: "bot" }; incoming.fetchReference = async () => rows[0];
  incoming.channel.messages.fetch = async options => { assert.deepEqual(options, { limit: 12, before: "latest", cache: false }); return new Map(rows.map(row => [row.id, row])); };
  const context = await conversationContext(incoming, "sakura-id");
  assert.deepEqual(context.recent.map(row => row.speaker), ["current_member", "sakura"]);
  assert.equal(context.replyTo, "sakura"); assert.equal(context.directMention, false);
  assert.equal(context.replyTarget.text, "Want some help?");
  assert.equal(JSON.stringify(context).includes("sakura-id"), false);
});

test("history failures and timeouts fall back to bounded cache without blocking direct messages", async () => {
  for (const fetcher of [async () => { throw Error("Missing history permission"); }, () => new Promise(() => {})]) {
    const incoming = message("hello", { guildId: null });
    incoming.channel.messages.fetch = fetcher;
    incoming.channel.messages.cache.set("cache", message("x".repeat(2000), { id: "cache", createdTimestamp: 999_000 }));
    const context = await conversationContext(incoming, "sakura-id", { timeoutMs: 10 });
    assert.equal(context.isDM, true); assert.equal(context.recent.length, 1); assert.equal(context.recent[0].text.length, 600);
  }
});

test("handler never sends user echoes or old assistant messages when routing skips", async () => {
  for (const output of [new HumanMessage("<think>hidden</think>user text"), new AIMessage("old response")]) {
    const incoming = message("<think>hidden</think>user text"), sent = [];
    incoming.channel.send = async text => sent.push(text);
    const handler = createMessageHandler({ logger, contextReader: async () => ({}), getGraph: async () => ({ invoke: async () => ({ next: "__end__", messages: [output] }) }) });
    assert.equal(await handler(incoming, "sakura-id"), false); assert.deepEqual(sent, []);
  }
});

test("handler passes fresh channel context and serializes rapid turns for the same member", async () => {
  let release, enter; const ready = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const seen = [], sent = [], inputs = [];
  const handler = createMessageHandler({ logger, contextReader: async () => ({ replyTo: "sakura", recent }), getGraph: async () => ({ invoke: async (input, config) => {
    inputs.push(input); seen.push(input.messages[0].content); assert.equal(config.configurable.thread_id, "alice");
    if (seen.length === 1) { enter(); await gate; }
    return { next: "sakura_llm", messages: [new AIMessage("A helpful answer.")] };
  } }) });
  const first = message("one"); first.channel.send = async text => sent.push(text);
  const one = handler(first, "sakura-id"); await ready;
  const two = handler({ ...first, content: "two" }, "sakura-id");
  await Promise.resolve(); assert.deepEqual(seen, ["one"]); release(); await Promise.all([one, two]);
  assert.deepEqual(seen, ["one", "two"]); assert.equal(sent.length, 2);
  assert.equal(inputs[0].force_respond, true); assert.deepEqual(inputs[1].routing_context.recent, recent);
});

test("ambient graph failures stay silent and failed sends are never posted twice", async () => {
  for (const direct of [false, true]) {
    const incoming = message(direct ? "Sakura, help" : "a side conversation"), sent = [];
    incoming.channel.send = async text => sent.push(text);
    const handler = createMessageHandler({ logger, contextReader: async () => ({}), getGraph: async () => { throw Error("fixture checkpoint failure"); } });
    assert.equal(await handler(incoming, "sakura-id"), false); assert.equal(sent.length, direct ? 1 : 0);
  }
  const incoming = message("Sakura, help"); let attempts = 0;
  incoming.channel.send = async () => { attempts++; throw Error("fixture Discord failure"); };
  const handler = createMessageHandler({ logger, contextReader: async () => ({}), getGraph: async () => ({ invoke: async () => ({ next: "sakura_llm", messages: [new AIMessage("An answer")] }) }) });
  assert.equal(await handler(incoming, "sakura-id"), false); assert.equal(attempts, 1);
});

test("graph can alternate between responding and silence without reusing a forced route", async t => {
  const saver = ConversationSqliteSaver.fromConnString(":memory:"); t.after(() => saver.db.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++; const payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: payload.max_tokens === 64 ? "skip" : "Would you like a suggestion?" } }] }) };
  });
  const graph = buildGraph(saver), config = { configurable: { thread_id: "router-integration" } };
  assert.equal((await graph.invoke(state("Sakura, help", {}, true), config)).next, "sakura_llm");
  const skipped = await graph.invoke(state("another member's topic"), config);
  assert.equal(skipped.next, "__end__"); assert.ok(skipped.messages.at(-1) instanceof HumanMessage);
  assert.equal((await graph.invoke(state("yes please", { recent }), config)).next, "sakura_llm");
  assert.equal((await graph.invoke(state("thanks lol", { recent }), config)).next, "__end__");
  assert.equal(calls, 3);
});
