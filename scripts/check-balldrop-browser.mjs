import { OBSTACLES } from "./fixtures/balldrop-layout.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { IdentityStore } from "../src/auth/store.js";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { BallDropStore, BallDropError } from "../src/balldrop/store.js";
import { createBallDropWeb } from "../src/balldrop/web.js";
import { GameSessions } from "../src/games/sessions.js";
import { createAuthServer } from "../src/auth/server.js";

if (!process.env.PUPPETEER_MODULE || !process.env.CHROME_PATH) throw new Error("Set PUPPETEER_MODULE and CHROME_PATH to local browser tools.");
const puppeteer = (await import(pathToFileURL(process.env.PUPPETEER_MODULE).href)).default;
const identities = new IdentityStore(":memory:"), receipts = new Map();
let coins = 200, loseCredit = false, failBalance = false, browser, server;
const client = { config: { baseUrl: "https://fixture.invalid/", clientId: "lidollbot" }, balance: async () => {
  if (failBalance) throw new WalletError("offline", "Fixture wallet unavailable.");
  return { accountId: "fixture", coins, stars: 0 };
}, operation: async (_token, input) => {
  let receipt = receipts.get(input.request_id);
  if (!receipt) {
    coins += input.kind === "debit" ? -input.amount : input.amount;
    receipt = { ...input, currency: "LiDollCoin", balance: coins }; receipts.set(input.request_id, receipt);
    if (loseCredit && input.kind === "credit") throw new WalletError("lost", "Fixture lost response.");
  }
  return receipt;
} };
const wallet = new WalletService(":memory:", client), game = new BallDropStore(":memory:", wallet, { enabled: true }, { draw: () => 0, obstacles: OBSTACLES });
try {
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("fixture", "issuer", "fixture", "Doll", Date.now());
  wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run("fixture", "fixture", Date.now() + 3600000, "fixture", client.config.baseUrl, client.config.clientId);
  const sessions = new GameSessions(game.db, identities, { prefix: "balldrop", command: "/balldrop", ErrorClass: BallDropError }), config = { origin: "http://127.0.0.1" };
  server = createAuthServer(config, identities, {}, wallet, createBallDropWeb(config, game, sessions));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); config.origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, pipe: true });
  const page = await browser.newPage(), errors = [], violations = [];
  await page.evaluateOnNewDocument(() => {
    const NativeAudio = window.AudioContext;
    window.soundProbe = { contexts: 0, starts: 0, peak: 0, cues: [] };
    window.AudioContext = class extends NativeAudio {
      constructor(...args) { super(...args); window.soundProbe.contexts++; }
      createGain() {
        const gain = super.createGain();
        if (!window.soundProbe.master) {
          window.soundProbe.master = gain;
          const analyser = this.createAnalyser(), samples = new Float32Array(analyser.fftSize);
          gain.connect(analyser);
          setInterval(() => { analyser.getFloatTimeDomainData(samples); for (const sample of samples) window.soundProbe.peak = Math.max(window.soundProbe.peak, Math.abs(sample)); }, 20);
        }
        return gain;
      }
      createOscillator() {
        const source = super.createOscillator(), start = source.start.bind(source);
        source.start = (...args) => { window.soundProbe.starts++; return start(...args); };
        return source;
      }
    };
  }); // Observe real Web Audio output without replacing the browser's renderer or contacting a wallet provider.
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
  page.setDefaultTimeout(15000); await page.setViewport({ width: 1360, height: 1100 });
  const idle = () => page.waitForFunction(() => !document.getElementById("refresh").disabled);
  await page.goto(`${config.origin}/balldrop/`); await page.waitForSelector("#signin:not([hidden])");
  assert.equal(await page.$eval("#drop", button => button.disabled), true);
  await page.goto(`${config.origin}/balldrop/open?ticket=${sessions.begin("fixture")}`);
  await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  await page.waitForFunction(() => document.getElementById("balance").textContent === "200");
  assert.equal(await page.evaluate(() => soundProbe.contexts), 0, "Loading a page must not start audio");
  await page.evaluate(() => {
    const play = prismSound.play;
    prismSound.play = (kind, detail) => { soundProbe.cues.push(kind); return play(kind, detail); };
  });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light");
  assert.equal(await page.$eval(".control-card", node => getComputedStyle(node).borderRadius), "24px");
  assert.match(await page.$eval("#peg-reset", node => node.textContent), /shuffled when you drop/);
  assert.equal(await page.$$eval("#pockets button", buttons => buttons.length), 10);
  assert.deepEqual(await page.$$eval("#bets button", buttons => buttons.map(button => Number(button.textContent))), [1, 5, 10, 25, 50, 100]);
  await page.click('[aria-label="Guess pocket 3"]'); await page.click('[aria-label="Bet 25 coins"]');
  assert.equal(await page.$eval("#return-near", node => node.textContent), "38 coins");
  await page.click("#drop");
  await page.waitForFunction(() => document.getElementById("controls-note").textContent.includes("Follow the glow"));
  assert.match(await page.$eval("#peg-reset", node => node.textContent), /Playing this drop's saved field/);
  assert.equal(await page.$eval("#drop", button => button.disabled), true);
  await new Promise(resolve => setTimeout(resolve, 1100));
  if (process.env.BALLDROP_SCREENSHOT_DIR) {
    await mkdir(process.env.BALLDROP_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.BALLDROP_SCREENSHOT_DIR, "prism-drop-desktop.png"), fullPage: true });
  }
  await idle(); assert.equal(coins, 215); assert.equal(receipts.size, 2);
  const audio = await page.evaluate(() => ({ contexts: soundProbe.contexts, starts: soundProbe.starts, peak: soundProbe.peak, cues: soundProbe.cues }));
  assert.equal(audio.contexts, 1); assert.ok(audio.starts > 20); assert.ok(audio.peak > .001 && audio.peak < 1, "Game sounds render audible, unclipped samples");
  for (const kind of ["drop", "peg", "block", "bomb", "coin", "landing"]) assert.ok(audio.cues.includes(kind), `Missing ${kind} sound`);
  assert.equal(await page.$eval("#result-value", node => node.textContent), "40 coins returned");
  assert.equal(await page.$eval("#peg-bonus", node => node.textContent), "2");
  assert.match(await page.$eval("#result-copy", node => node.textContent), /Landing return: 38 coins. Coin pegs: \+2 coins/);
  const saved = game.snapshot("fixture").round;
  assert.ok(saved.trajectory.some(point => point.hit === "bomb")); assert.ok(saved.trajectory.some(point => point.hit === "block"));
  assert.equal(saved.trajectory.filter(point => point.hit === "coin").length, 2);
  assert.ok(saved.trajectory.some((point, index) => index && point.row < saved.trajectory[index - 1].row));
  await page.click("#replay");
  await page.waitForFunction(() => document.getElementById("refresh").disabled);
  await page.click("#sound");
  assert.equal(await page.$eval("#sound", node => node.getAttribute("aria-pressed")), "false");
  const mutedStarts = await page.evaluate(() => soundProbe.starts);
  await idle(); assert.equal(receipts.size, 2);
  assert.equal(await page.evaluate(() => soundProbe.starts), mutedStarts, "Muting during replay prevents later notes");
  assert.equal(await page.evaluate(() => soundProbe.master.gain.value), 0);
  await page.reload(); await page.waitForFunction(() => document.getElementById("balance").textContent === "215");
  assert.equal(await page.$eval("#sound", node => node.textContent), "Sound: off");
  assert.equal(await page.evaluate(() => soundProbe.contexts), 0);
  await page.click("#sound");
  assert.equal(await page.$eval("#sound", node => node.getAttribute("aria-pressed")), "true");
  assert.equal(await page.$eval("#result-value", node => node.textContent), "40 coins returned");
  await page.setViewport({ width: 390, height: 844 });
  await page.click('[aria-label="Guess pocket 3"]'); await page.click('[aria-label="Bet 25 coins"]');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.BALLDROP_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.BALLDROP_SCREENSHOT_DIR, "prism-drop-mobile.png"), fullPage: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  loseCredit = true; await page.click("#drop"); await idle();
  assert.equal(coins, 230); assert.equal(await page.$eval("#pending", node => node.hidden), false);
  assert.match(await page.$eval("#result-value", node => node.textContent), /pending/);
  await page.click("#retry"); await idle(); assert.equal(coins, 230); assert.equal(receipts.size, 4);
  assert.equal(await page.$eval("#pending", node => node.hidden), true);
  failBalance = true; await page.click("#refresh"); await idle(); assert.equal(await page.$eval("#drop", node => node.disabled), true);
  failBalance = false; coins = 0; await page.click("#refresh"); await idle(); assert.match(await page.$eval("#controls-note", node => node.textContent), /need 25 coins/);
  coins = 100; await page.click("#refresh"); await idle();
  await page.evaluate(() => { crypto.randomUUID = () => { throw Error("fixture"); }; });
  await page.click("#drop"); await idle(); assert.equal(coins, 100); assert.match(await page.$eval("#notice", node => node.textContent), /Nothing was sent/);
  await page.evaluate(() => { crypto.randomUUID = undefined; });
  loseCredit = false; await page.click('[aria-label="Bet 1 coin"]'); await page.click("#drop"); await idle(); assert.equal(coins, 103);
  game.obstacles = undefined; // Exercise production field generation after the fixed collision and payment cases.
  let seed = 918;
  game.draw = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * max); };
  await page.click("#drop"); await idle(); const firstRandom = game.snapshot("fixture").round;
  await page.click("#drop"); await idle(); const secondRandom = game.snapshot("fixture").round;
  assert.equal(secondRandom.obstacles.length, 28); assert.notDeepEqual(secondRandom.obstacles, firstRandom.obstacles);
  assert.match(await page.$eval("#peg-reset", node => node.textContent), /Saved field shown/);
  const savedCoins = coins, savedReceipts = receipts.size;
  const beforeReduced = await page.evaluate(() => soundProbe.starts);
  await page.click("#replay"); await idle(); await page.reload(); await idle();
  assert.ok(beforeReduced > 0, "Reduced-motion drops still play landing cues");
  assert.equal(await page.evaluate(() => soundProbe.contexts), 0, "Restoring a saved result stays silent");
  assert.deepEqual(game.snapshot("fixture").round, secondRandom);
  assert.equal(coins, savedCoins); assert.equal(receipts.size, savedReceipts);
  assert.equal(await page.$eval("#peg-bonus", node => Number(node.textContent)), secondRandom.bonus);
  for (const failure of ["unsupported", "device-error"]) {
    const quiet = await browser.newPage(); quiet.on("pageerror", error => errors.push(error.message));
    await quiet.evaluateOnNewDocument(mode => {
      window.AudioContext = mode === "unsupported" ? undefined : class { constructor() { throw Error("Fixture audio device failure"); } };
      window.webkitAudioContext = undefined;
      Storage.prototype.getItem = () => { throw Error("Fixture blocked storage"); };
      Storage.prototype.setItem = () => { throw Error("Fixture blocked storage"); };
    }, failure);
    await quiet.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await quiet.goto(`${config.origin}/balldrop/`); await quiet.waitForFunction(() => !document.getElementById("drop").disabled);
    const previous = game.snapshot("fixture").round.id;
    await quiet.click("#drop"); await quiet.waitForFunction(() => !document.getElementById("refresh").disabled);
    assert.notEqual(game.snapshot("fixture").round.id, previous, "Audio/storage failures do not block wagers");
    assert.equal(await quiet.$eval("#sound", node => node.textContent), "Sound unavailable");
    await quiet.close();
  }
  await page.click("#logout"); await page.waitForFunction(() => !document.getElementById("signin").hidden && document.getElementById("balance").textContent === "—");
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  console.log("PASS: Chrome desktop/mobile, real sound output, collision cues, mute persistence, audio/storage failure recovery, shuffled fields, coin payouts, replay, reduced motion and logout. No real coins used.");
} finally {
  await browser?.close();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await wallet.close(); game.close(); identities.close();
}
