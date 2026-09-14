import assert from "node:assert/strict";
import test from "node:test";
import { createGachaCommands } from "../src/gacha/index.js";
import { GachaError } from "../src/gacha/store.js";

test("singular and plural diaper commands register independently and failures log no private data", async t => {
  const attempts = [], logs = [];
  t.mock.method(console, "log", message => logs.push(message));
  t.mock.method(console, "error", message => logs.push(message));
  const commands = createGachaCommands({}, {});
  await commands.registerGuild({ id: "guild", commands: { create: async command => {
    const value = command.toJSON(); attempts.push(value.name);
    if (value.name === "diaper") throw Object.assign(new Error("PRIVATE RESPONSE"), { code: 50001 });
  } } });
  assert.deepEqual(attempts, ["diaper", "diapers"]);
  assert.match(logs.join("\n"), /Discord code 50001/);
  assert.match(logs.join("\n"), /\/diapers ready/);
  assert.doesNotMatch(logs.join("\n"), /PRIVATE RESPONSE/);
});

test("both diaper spellings issue the same private handoff and ignore unrelated interactions", async () => {
  const users = [], replies = [];
  const commands = createGachaCommands({ origin: "https://bot.example" }, { begin: user => { users.push(user); return "fixture-ticket"; } });
  for (const commandName of ["diaper", "diapers"]) {
    assert.equal(await commands.handleInteraction({ commandName, isChatInputCommand: () => true, user: { id: "alice" },
      deferReply: async options => assert.equal(options.flags, 64), editReply: async response => replies.push(response) }), true);
  }
  assert.deepEqual(users, ["alice", "alice"]);
  assert.deepEqual(replies[0], replies[1]);
  assert.match(replies[0].content, /https:\/\/bot.example\/diapers\/open\?ticket=fixture-ticket/);
  assert.deepEqual(replies[0].allowedMentions, { parse: [] });
  assert.equal(await commands.handleInteraction({ isChatInputCommand: () => true, commandName: "touhou" }), false);
  assert.equal(await commands.handleInteraction({ isChatInputCommand: () => false }), false);
});

test("!diapers sends the handoff only by DM and closed DMs get a safe slash fallback", async () => {
  const privateReplies = [], publicReplies = [], users = [];
  const commands = createGachaCommands({ origin: "https://bot.example" }, { begin: user => { users.push(user); return "PRIVATE-TICKET"; } });
  const message = { content: " !Diapers ", guild: { id: "guild" }, author: { id: "alice", bot: false, send: async response => privateReplies.push(response) }, reply: async response => publicReplies.push(response) };
  assert.equal(await commands.handleMessage(message), true);
  assert.deepEqual(users, ["alice"]);
  assert.match(privateReplies[0].content, /PRIVATE-TICKET/);
  assert.match(publicReplies[0].content, /DMs/);
  assert.doesNotMatch(JSON.stringify(publicReplies), /PRIVATE-TICKET|ticket=/);
  assert.deepEqual(publicReplies[0].allowedMentions, { parse: [], repliedUser: false });
  message.author.send = async () => { throw new Error("Private Discord response"); };
  assert.equal(await commands.handleMessage(message), true);
  assert.match(publicReplies.at(-1).content, /Use \/diapers/);
  assert.doesNotMatch(JSON.stringify(publicReplies), /PRIVATE-TICKET|Private Discord response/);
});

test("prefix routing ignores bots and unrelated text, and safely handles unlinked accounts and reply failures", async t => {
  let begins = 0, sent = 0; const replies = [], logs = [];
  t.mock.method(console, "warn", message => logs.push(message));
  const commands = createGachaCommands({}, { begin: () => { begins++; throw new GachaError("Link with /lidollid login first."); } });
  const message = { content: "!diapers", guild: {}, author: { id: "alice", bot: false, send: async () => { sent++; } }, reply: async response => replies.push(response) };
  for (const content of ["!diapers roll", "hello !diapers", "!touhou"]) assert.equal(await commands.handleMessage({ ...message, content }), false);
  assert.equal(await commands.handleMessage({ ...message, author: { ...message.author, bot: true } }), false);
  assert.equal(begins, 0);
  assert.equal(await commands.handleMessage(message), true); assert.equal(sent, 0);
  assert.match(replies[0].content, /lidollid login/);
  message.reply = async () => { throw new Error("PRIVATE permission response"); };
  assert.equal(await commands.handleMessage(message), true);
  assert.doesNotMatch(logs.join(" "), /PRIVATE/);
});
