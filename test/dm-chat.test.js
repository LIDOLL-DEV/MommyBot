import test from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import { createDmGate } from "../src/bot/dmGate.js";
import { createMessageHandler } from "../src/bot/handlers/message.js";

const logger = { log() {}, warn() {}, error() {} };
const guild = (id, members) => ({ id, members: { cache: new Map(), fetch: async userId => { if (!members.includes(userId)) throw Error("Unknown Member"); return { id: userId }; } } });
const client = guilds => ({ guilds: { cache: new Map(guilds.map(g => [g.id, g])) } });
const dm = (sent, author = "alice") => ({ id: "m", content: "hi Sakura", guildId: null, channelId: "dm", createdTimestamp: 1,
  author: { id: author, bot: false, toString: () => `<@${author}>` }, mentions: { users: new Map() }, channel: { id: "dm", send: async text => sent.push(text) } });

test("DMs are allowed only for members of a server where chat is enabled", async () => {
  const sent = [], chatOn = new Set(["open"]);
  const allow = createDmGate({ client: client([guild("closed", ["bob"]), guild("open", ["alice"])]), chatEnabled: id => chatOn.has(id), env: {}, logger });
  assert.equal(await allow(dm(sent, "alice")), true);
  assert.equal(await allow(dm(sent, "bob")), false, "membership in a server with chat off does not open DMs");
  assert.equal(await allow(dm(sent, "stranger")), false);
  assert.equal(sent.length, 2); assert.match(sent[0], /members of a server/);
});

test("DM_CHAT_ENABLED=false closes DMs, and a declined member is told at most once a day", async () => {
  let clock = 0; const sent = [];
  const allow = createDmGate({ client: client([guild("open", ["alice"])]), chatEnabled: () => true, env: { DM_CHAT_ENABLED: "false" }, now: () => clock, logger });
  assert.equal(await allow(dm(sent)), false); assert.equal(await allow(dm(sent)), false);
  assert.equal(sent.length, 1); assert.match(sent[0], /isn't chatting in DMs/);
  clock += 24 * 60 * 60_000; await allow(dm(sent)); assert.equal(sent.length, 2);
});

test("DM conversations use their own memory thread and reply without a ping", async () => {
  const threads = [], sent = [];
  const handler = createMessageHandler({ logger, contextReader: async () => ({ isDM: true }), getGraph: async () => ({ invoke: async (input, config) => {
    threads.push(config.configurable.thread_id); assert.equal(input.force_respond, true); assert.equal(input.member_pronouns, "they/them");
    return { next: "sakura_llm", messages: [new AIMessage("Hello there!")] };
  } }) });
  assert.equal(await handler(dm(sent), "sakura-id"), true);
  assert.deepEqual(threads, ["dm:alice"]); assert.deepEqual(sent, ["Hello there!"]);
});
