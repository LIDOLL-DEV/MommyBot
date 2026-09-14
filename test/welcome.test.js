import assert from "node:assert/strict";
import test from "node:test";
import { GatewayIntentBits } from "discord.js";
import { createClient } from "../src/bot/client.js";
import { generateWelcomeMessage, welcomeProse } from "../src/graph/welcomeMessage.js";
import { createMemberWelcome, WELCOME_CHANNEL_ID, RULES_CHANNEL_ID, RULES_MESSAGE_ID } from "../src/welcome.js";

const member = { guild: { id: "1476335174815056087" }, user: { id: "111111111111111111", username: "PRIVATE NAME", bot: false }, joinedTimestamp: 1000 };
const answer = content => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });

function fixture(options = {}) {
  const sent = [], generated = [];
  const channel = { guildId: member.guild.id, isTextBased: () => true, send: async body => { sent.push(body); } };
  const client = { channels: { fetch: async id => { assert.equal(id, WELCOME_CHANNEL_ID); return channel; } } };
  const welcome = createMemberWelcome(client, { env: {}, generateMessage: async input => { generated.push(input); return "Welcome, sweet girl! We're happy you're here."; }, ...options });
  return { sent, generated, channel, client, welcome };
} // Replace only Discord transport and inference so tests cannot post to the real server.

test("new-member generation uses .250 independently of chat/router overrides and includes no member data", async () => {
  const calls = [];
  assert.equal(await generateWelcomeMessage({
    env: { LLAMA_BASE_URL: "http://other.example/v1", ROUTER_LAMA_URL: "http://router.example/v1", LLAMA_MODEL: "mommy-model", SYSTEM_PROMPT: "Be warm." },
    fetcher: async (url, options) => { calls.push({ url, options }); return answer("<think>private reasoning</think>Welcome, sweet girl!"); },
  }), "Welcome, sweet girl!");
  assert.equal(calls[0].url, "http://192.168.1.250:9090/v1/chat/completions");
  const { options } = calls[0], payload = JSON.parse(options.body);
  assert.equal(options.method, "POST"); assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
  assert.equal(payload.model, "mommy-model"); assert.equal(payload.chat_template_kwargs.enable_thinking, false);
  assert.match(payload.messages[0].content, /Be warm/); assert.match(payload.messages[0].content, /she\/her/);
  assert.match(payload.messages[0].content, /read the rules and complete account registration/);
  assert.doesNotMatch(options.body, /PRIVATE NAME|111111111111111111|1548865939691405423|account_id|access_token|bearer/i);
});

test("unsafe, blank, reasoning-only, malformed, failed and timed-out generation uses a safe fallback", async t => {
  const errors = []; t.mock.method(console, "error", message => errors.push(message));
  for (const text of [undefined, "", "<think>unfinished", "<think>hidden</think>", "@everyone hi", "<@111111111111111111>", "https://example.com", "www.example.com", "```hello```", "x".repeat(501), "Hello boys and girls!", "He's welcome!", "Run /lidollid login", "You have 500 coins"]) {
    assert.equal(welcomeProse(text), null);
    assert.equal(await generateWelcomeMessage({ env: {}, fetcher: async () => answer(text) }), null);
  }
  for (const fetcher of [async () => ({ ok: false, status: 503 }), async () => { throw new DOMException("PRIVATE", "TimeoutError"); }, async () => ({ ok: true, json: async () => { throw new SyntaxError("PRIVATE"); } })]) {
    assert.equal(await generateWelcomeMessage({ env: {}, fetcher }), null);
  }
  assert.ok(errors.some(message => message.includes("HTTP 503")));
  assert.ok(errors.some(message => message.includes("REQUEST_TIMEOUT")));
  assert.ok(errors.every(message => !message.includes("PRIVATE")));
  assert.equal(await generateWelcomeMessage({ env: { WELCOME_AI_ENABLED: "false" }, fetcher: () => assert.fail("AI is paused") }), null);
});

test("welcome tags only the newcomer and always links the verified rules message and full Discord confirmation steps", async () => {
  const f = fixture();
  assert.equal(await f.welcome.handleMemberAdd(member), true);
  assert.equal(f.sent.length, 1);
  const message = f.sent[0];
  assert.ok(message.content.startsWith(`<@${member.user.id}> Welcome, sweet girl!`));
  assert.match(message.content, new RegExp(`https://discord.com/channels/${member.guild.id}/${RULES_CHANNEL_ID}/${RULES_MESSAGE_ID}`));
  for (const text of ["read the server rules", "see the whole server", "LiD0llID", "/menu", "Connect / renew", "Enter sign-in code", "/lidollid confirm", "/lidollid status"]) assert.ok(message.content.includes(text), text);
  assert.deepEqual(message.allowedMentions, { parse: [], users: [member.user.id], repliedUser: false });
  assert.ok(message.content.length <= 2000); assert.equal(message.enforceNonce, true); assert.equal(message.nonce.length, 24);
  assert.doesNotMatch(JSON.stringify(f.generated), /PRIVATE NAME|111111111111111111/);
});

test("inference failures retain the rules and registration instructions without publishing raw errors", async () => {
  for (const generateMessage of [async () => null, async () => { throw new Error("PRIVATE"); }, async () => "@everyone PRIVATE"]) {
    const f = fixture({ generateMessage });
    assert.equal(await f.welcome.handleMemberAdd(member), true);
    assert.match(f.sent[0].content, /Welcome, sweet girl/); assert.match(f.sent[0].content, /Enter sign-in code/);
    assert.doesNotMatch(f.sent[0].content, /PRIVATE|@everyone/);
  }
});

test("duplicate events share an in-flight welcome and a later genuine rejoin gets a fresh welcome", async () => {
  let release;
  const f = fixture({ generateMessage: () => new Promise(resolve => { release = resolve; }) });
  const first = f.welcome.handleMemberAdd(member), duplicate = f.welcome.handleMemberAdd(member);
  assert.equal(first, duplicate);
  await new Promise(resolve => setImmediate(resolve)); release("Welcome, sweet girl!");
  await first; assert.equal(await f.welcome.handleMemberAdd(member), false); assert.equal(f.sent.length, 1);
  const rejoin = f.welcome.handleMemberAdd({ ...member, joinedTimestamp: 2000 });
  await new Promise(resolve => setImmediate(resolve)); release("Welcome back, sweet girl!");
  await rejoin; assert.equal(f.sent.length, 2); assert.notEqual(f.sent[0].nonce, f.sent[1].nonce);
});

test("bots, other servers, missing channels, disabled welcomes and stopped handlers cannot post", async t => {
  t.mock.method(console, "error", () => {});
  const f = fixture();
  assert.equal(await f.welcome.handleMemberAdd({ ...member, user: { ...member.user, bot: true } }), false);
  assert.equal(await f.welcome.handleMemberAdd({ ...member, guild: { id: "another-server" } }), false);
  f.client.channels.fetch = async () => { throw new Error("PRIVATE Discord body"); };
  assert.equal(await f.welcome.handleMemberAdd(member), false);
  assert.equal(f.generated.length, 0); assert.equal(f.sent.length, 0);
  const disabled = fixture({ env: { WELCOME_ENABLED: "false" } });
  assert.equal(await disabled.welcome.handleMemberAdd(member), false); assert.equal(disabled.generated.length, 0);
  const stopped = fixture(); await stopped.welcome.stop();
  assert.equal(await stopped.welcome.handleMemberAdd(member), false); assert.equal(stopped.sent.length, 0);
});

test("shutdown waits for active work and does not start a send after pending inference finishes", async () => {
  let release;
  const f = fixture({ generateMessage: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.welcome.handleMemberAdd(member);
  await new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const closing = f.welcome.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false);
  release("Welcome, sweet girl!"); await closing; await pending;
  assert.equal(stopped, true); assert.equal(f.sent.length, 0);
});

test("Discord send failures are contained and only log a safe operator message", async t => {
  const errors = []; t.mock.method(console, "error", line => errors.push(line));
  const f = fixture(); f.channel.send = async () => { throw new Error("PRIVATE token"); };
  assert.equal(await f.welcome.handleMemberAdd(member), false);
  assert.equal(errors.length, 1); assert.doesNotMatch(errors[0], /PRIVATE|token/);
});

test("Discord client requests member-join events unless welcomes are disabled", async () => {
  for (const enabled of [true, false]) {
    const client = createClient({ WELCOME_ENABLED: String(enabled) });
    assert.equal(client.options.intents.has(GatewayIntentBits.GuildMembers), enabled);
    assert.equal(client.options.intents.has(GatewayIntentBits.MessageContent), true);
    await client.destroy();
  }
});
