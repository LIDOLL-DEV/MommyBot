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
const wallet = new WalletService(":memory:", client), game = new BallDropStore(":memory:", wallet, { enabled: true }, { draw: () => 0 });
try {
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("fixture", "issuer", "fixture", "Doll", Date.now());
  wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run("fixture", "fixture", Date.now() + 3600000, "fixture", client.config.baseUrl, client.config.clientId);
  const sessions = new GameSessions(game.db, identities, { prefix: "balldrop", command: "/balldrop", ErrorClass: BallDropError }), config = { origin: "http://127.0.0.1" };
  server = createAuthServer(config, identities, {}, wallet, createBallDropWeb(config, game, sessions));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); config.origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, pipe: true });
  const page = await browser.newPage(), errors = [], violations = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
  page.setDefaultTimeout(15000); await page.setViewport({ width: 1360, height: 1100 });
  const idle = () => page.waitForFunction(() => !document.getElementById("refresh").disabled);
  await page.goto(`${config.origin}/balldrop/`); await page.waitForSelector("#signin:not([hidden])");
  assert.equal(await page.$eval("#drop", button => button.disabled), true);
  await page.goto(`${config.origin}/balldrop/open?ticket=${sessions.begin("fixture")}`);
  await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  await page.waitForFunction(() => document.getElementById("balance").textContent === "200");
  assert.equal(await page.$$eval("#pockets button", buttons => buttons.length), 10);
  assert.deepEqual(await page.$$eval("#bets button", buttons => buttons.map(button => Number(button.textContent))), [1, 5, 10, 25, 50, 100]);
  await page.click('[aria-label="Guess pocket 3"]'); await page.click('[aria-label="Bet 25 coins"]');
  assert.equal(await page.$eval("#return-near", node => node.textContent), "38 coins");
  await page.click("#drop");
  await page.waitForFunction(() => document.getElementById("controls-note").textContent.includes("Follow the glow"));
  assert.equal(await page.$eval("#drop", button => button.disabled), true);
  await new Promise(resolve => setTimeout(resolve, 1100));
  if (process.env.BALLDROP_SCREENSHOT_DIR) {
    await mkdir(process.env.BALLDROP_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.BALLDROP_SCREENSHOT_DIR, "prism-drop-desktop.png"), fullPage: true });
  }
  await idle(); assert.equal(coins, 213); assert.equal(receipts.size, 2);
  assert.equal(await page.$eval("#result-value", node => node.textContent), "38 coins returned");
  await page.click("#replay"); await idle(); assert.equal(receipts.size, 2);
  await page.reload(); await page.waitForFunction(() => document.getElementById("balance").textContent === "213");
  assert.equal(await page.$eval("#result-value", node => node.textContent), "38 coins returned");
  await page.setViewport({ width: 390, height: 844 });
  await page.click('[aria-label="Guess pocket 3"]'); await page.click('[aria-label="Bet 25 coins"]');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.BALLDROP_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.BALLDROP_SCREENSHOT_DIR, "prism-drop-mobile.png"), fullPage: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  loseCredit = true; await page.click("#drop"); await idle();
  assert.equal(coins, 226); assert.equal(await page.$eval("#pending", node => node.hidden), false);
  assert.match(await page.$eval("#result-value", node => node.textContent), /pending/);
  await page.click("#retry"); await idle(); assert.equal(coins, 226); assert.equal(receipts.size, 4);
  assert.equal(await page.$eval("#pending", node => node.hidden), true);
  failBalance = true; await page.click("#refresh"); await idle(); assert.equal(await page.$eval("#drop", node => node.disabled), true);
  failBalance = false; coins = 0; await page.click("#refresh"); await idle(); assert.match(await page.$eval("#controls-note", node => node.textContent), /need 25 coins/);
  coins = 100; await page.click("#refresh"); await idle();
  await page.evaluate(() => { crypto.randomUUID = () => { throw Error("fixture"); }; });
  await page.click("#drop"); await idle(); assert.equal(coins, 100); assert.match(await page.$eval("#notice", node => node.textContent), /Nothing was sent/);
  await page.evaluate(() => { crypto.randomUUID = undefined; });
  loseCredit = false; await page.click('[aria-label="Bet 1 coin"]'); await page.click("#drop"); await idle(); assert.equal(coins, 101);
  await page.click("#logout"); await page.waitForFunction(() => !document.getElementById("signin").hidden && document.getElementById("balance").textContent === "—");
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  console.log("PASS: Chrome desktop/mobile, 200-pin canvas, colored trails, wallet bet/rounded payout, free replay, refresh, payment recovery, reduced motion, disabled controls and logout. No real coins used.");
} finally {
  await browser?.close();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await wallet.close(); game.close(); identities.close();
}
