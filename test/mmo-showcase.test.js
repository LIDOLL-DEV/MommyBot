import test from "node:test";
import assert from "node:assert/strict";
import { readCharacter, fetchCharacter, characterConfig, GEAR_SLOTS } from "../src/mmo/character.js";
import { createCharacterShowcase, paperdollMessage, statsMessage, equipmentMessage } from "../src/mmo/showcase.js";

const TOKEN = "x".repeat(43);
const ENV = { LIDOLLMMO_CHARACTERS_ENABLED: "true", LIDOLLMMO_ONLINE_URL: "http://10.1.1.23:4191/integrations/mommybot/joins", MOMMYBOT_ONLINE_TOKEN: TOKEN };

const sheet = (overrides = {}) => ({
  character_id: "char-1", name: "Friend", level: 12, class_id: "mage", online: true,
  player_info: { gender: "Female", hair_color: "Brown", hair_style: 3, face_expression: "cheeky",
    inspection_embarrassment: 2, had_wet_accident: true, had_tum_accident: false, panties_bulk: 4 },
  equipment: GEAR_SLOTS.map((slot, index) => ({ slot, item_id: index < 2 ? `item_${index}` : "", name: index < 2 ? `Item ${index}` : "(empty)" })),
  characters: [{ id: "char-1", name: "Friend" }, { id: "char-2", name: "Second" }], ...overrides });

function fixture(t, { body = sheet(), status = 200 } = {}) {
  const f = { sent: [], replies: [], logs: [], now: 1000, requests: [], body, status, settings: { enabled: true, channel: "showcase" } };
  f.channel = { guildId: "guild", isTextBased: () => true, async send(payload) { if (f.failSend) throw new Error("Discord offline"); f.sent.push(payload); return { id: "m" }; } };
  f.client = { channels: { async fetch(id) { return id === "showcase" ? f.channel : null; } },
    guilds: { cache: new Map([["guild", { id: "guild" }]]) } };
  f.identities = { get: id => f.linked === false ? null : { discord_id: id, issuer: "issuer", subject: "sub" } };
  f.wallet = { connection: () => f.connected === false ? null : { account_id: "account-1" } };
  f.fetcher = async url => {
    f.requests.push(String(url));
    if (f.networkError) throw new Error("offline");
    return { ok: f.status >= 200 && f.status < 300, status: f.status,
      body: (async function* () { yield Buffer.from(JSON.stringify(f.body)); })() };
  };
  f.bot = createCharacterShowcase(f.client, f.wallet, f.identities, ENV, {
    settings: () => ({ showcase: f.settings }), fetcher: (...a) => f.fetcher(...a), now: () => f.now,
    logger: { log: () => {}, error: line => f.logs.push(line) } });
  f.run = async (overrides = {}) => {
    const seen = { content: null, ephemeral: false, deferred: false };
    const interaction = { isChatInputCommand: () => true, commandName: "lidollmmo", id: "i1", guildId: "guild",
      user: { id: "alice" }, options: { getString: () => f.character ?? null },
      async deferReply(options) { seen.deferred = true; seen.ephemeral = Boolean(options?.flags); },
      async reply(options) { seen.content = options.content; seen.ephemeral = Boolean(options.flags); },
      async editReply(options) { seen.content = options.content; return {}; }, ...overrides };
    assert.equal(await f.bot.handleInteraction(interaction), true);
    return seen;
  };
  t.after(async () => { await f.bot?.stop(); });
  return f;
}

test("a character sheet is validated, sanitized and mapped into three ordered messages", () => {
  const character = readCharacter(sheet({ name: "Fri‮end", equipment: [{ slot: "weapon", item_id: "w", name: "Wand" }] }));
  assert.equal(character.name, "Fri end"); // Bidirectional overrides cannot reorder a Discord message.
  assert.equal(character.equipment[0].name, "Wand");
  assert.equal(character.portrait, null);
  const full = readCharacter(sheet());
  const [doll, stats, gear] = [paperdollMessage(full), statsMessage(full, "alice"), equipmentMessage(full)];
  assert.match(doll.embeds[0].title, /Paperdoll$/);
  assert.match(doll.embeds[0].footer.text, /image unavailable/);
  assert.equal(doll.files.length, 0);
  assert.match(stats.embeds[0].title, /Stats$/);
  assert.equal(stats.embeds[0].fields.find(field => field.name === "Level").value, "12");
  assert.equal(stats.embeds[0].fields.find(field => field.name === "Class").value, "Mage");
  assert.match(stats.embeds[0].description, /<@alice>/);
  assert.match(gear.embeds[0].title, /Equipment$/);
  assert.equal(gear.embeds[0].description.split("\n").length, GEAR_SLOTS.length); // Every slot is listed, empty ones included.
  assert.match(gear.embeds[0].description, /\*\*Weapon:\*\* Item 0/);
  assert.match(gear.embeds[0].description, /\*\*Plug:\*\* \*\(empty\)\*/);
  assert.equal(gear.embeds[0].footer.text, `2 of ${GEAR_SLOTS.length} slots equipped`);
});

test("a game-supplied portrait becomes an image attachment", () => {
  const png = Buffer.from("fake png data").toString("base64");
  const character = readCharacter(sheet({ portrait_png: png }));
  const doll = paperdollMessage(character);
  assert.equal(doll.files.length, 1);
  assert.equal(doll.embeds[0].image.url, "attachment://paperdoll.png");
  assert.doesNotMatch(doll.embeds[0].footer.text, /unavailable/);
  assert.equal(readCharacter(sheet({ portrait_png: "not base64!!" })).portrait, null);
});

test("malformed sheets are rejected rather than posted", () => {
  for (const body of [null, "text", sheet({ name: "" }), sheet({ level: 0 }), sheet({ level: 1.5 }),
    sheet({ character_id: "../etc" }), sheet({ equipment: "none" }), sheet({ equipment: [{ slot: "hat", name: "x" }] }),
    sheet({ player_info: null })]) {
    assert.throws(() => readCharacter(body), /unexpected format|/);
  }
});

test("the showcase posts three messages in the configured channel and answers privately", async t => {
  const f = fixture(t);
  const seen = await f.run();
  assert.equal(seen.deferred, true); assert.equal(seen.ephemeral, true);
  assert.equal(f.sent.length, 3);
  assert.match(f.sent[0].embeds[0].title, /Paperdoll$/);
  assert.match(f.sent[1].embeds[0].title, /Stats$/);
  assert.match(f.sent[2].embeds[0].title, /Equipment$/);
  assert.deepEqual(f.sent[0].allowedMentions, { parse: [] });
  assert.deepEqual(f.sent[1].allowedMentions, { parse: [], users: ["alice"] });
  assert.match(seen.content, /<#showcase>/);
  assert.match(seen.content, /Other characters: `Second`/);
  assert.match(f.requests[0], /account_id=account-1/);
});

test("the showcase is refused without a configured channel, a link or a wallet", async t => {
  const f = fixture(t);
  f.settings = { enabled: false, channel: "showcase" };
  assert.match((await f.run()).content, /no LiDollQuest showcase channel/);
  f.settings = { enabled: true, channel: "" };
  assert.match((await f.run()).content, /no LiDollQuest showcase channel/);
  assert.match((await f.run({ guildId: null })).content, /no LiDollQuest showcase channel/);
  f.settings = { enabled: true, channel: "showcase" };
  f.linked = false;
  assert.match((await f.run()).content, /lidollid login/);
  f.linked = true; f.connected = false;
  assert.match((await f.run()).content, /Connect your wallet/);
  assert.equal(f.sent.length, 0);
});

test("game server and network failures produce a private, credential-free explanation", async t => {
  const f = fixture(t);
  f.status = 404;
  assert.match((await f.run()).content, /No LiDollQuest character was found/);
  f.status = 401;
  assert.match((await f.run()).content, /MOMMYBOT_ONLINE_TOKEN/);
  f.status = 503;
  assert.match((await f.run()).content, /disabled on the game server/);
  f.status = 200; f.networkError = true;
  assert.match((await f.run()).content, /could not be reached/);
  assert.equal(f.sent.length, 0);
  assert.doesNotMatch(JSON.stringify(f.logs), new RegExp(TOKEN));
});

test("a member may showcase once a minute, and a failed attempt does not spend the cooldown", async t => {
  const f = fixture(t);
  await f.run();
  assert.equal(f.sent.length, 3);
  assert.match((await f.run()).content, /Give the showcase a moment/);
  assert.equal(f.sent.length, 3);
  f.now += 60_000;
  await f.run();
  assert.equal(f.sent.length, 6);
  f.now += 60_000; f.failSend = true;
  await f.run();
  f.failSend = false;
  await f.run(); // The failed attempt released the cooldown immediately.
  assert.equal(f.sent.length, 9);
});

test("the command is only enabled with a token, a feed URL and a linked wallet service", () => {
  assert.equal(characterConfig({}), null);
  assert.equal(characterConfig({ LIDOLLMMO_CHARACTERS_ENABLED: "true" }), null);
  assert.throws(() => characterConfig({ ...ENV, MOMMYBOT_ONLINE_TOKEN: "short" }), /Invalid character feed configuration/);
  assert.equal(characterConfig(ENV).url, "http://10.1.1.23:4191/integrations/mommybot/character");
  assert.equal(characterConfig({ ...ENV, LIDOLLMMO_CHARACTER_URL: "https://game.example/custom" }).url, "https://game.example/custom");
  const logs = [];
  const logger = { log: line => logs.push(line), error: line => logs.push(line) };
  assert.equal(createCharacterShowcase({}, null, {}, ENV, { logger }), null);
  assert.equal(createCharacterShowcase({}, {}, null, ENV, { logger }), null);
  assert.equal(createCharacterShowcase({}, {}, {}, {}, { logger }), null);
  assert.ok(logs.every(line => !line.includes(TOKEN)));
});

test("an oversized character response is refused instead of buffered", async () => {
  const fetcher = async () => ({ ok: true, status: 200, body: (async function* () {
    for (let page = 0; page < 20; page++) yield Buffer.alloc(1_000_000);
  })() });
  await assert.rejects(fetchCharacter({ url: "http://host/character", token: TOKEN }, "account-1", { fetcher }), /larger than expected/);
});
