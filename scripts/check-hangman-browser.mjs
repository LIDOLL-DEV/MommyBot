import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { IdentityStore } from "../src/auth/store.js";
import { createAuthServer } from "../src/auth/server.js";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { HangmanStore, HangmanError } from "../src/hangman/store.js";
import { hangmanConfig } from "../src/hangman/words.js";
import { createHangmanWeb } from "../src/hangman/web.js";
import { GameSessions } from "../src/games/sessions.js";

if (!process.env.PUPPETEER_MODULE || !process.env.CHROME_PATH) throw new Error("Set PUPPETEER_MODULE and CHROME_PATH to your local browser tools.");
const puppeteer = (await import(pathToFileURL(process.env.PUPPETEER_MODULE).href)).default;
const identities = new IdentityStore(":memory:"), receipts = new Map();
let coins = 20, browser, server, game, wallet, loseResponse = false, balanceFailure = false, holdBalance = null, releaseBalance;
try {
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("fixture", "https://auth.example", "fixture", "Doll", Date.now());
  wallet = new WalletService(":memory:", { config: { baseUrl: "https://fixture.invalid/", clientId: "lidollbot" },
    balance: async () => {
      if (balanceFailure) throw new WalletError("unavailable", "Your wallet is unavailable. Press Refresh to try again.");
      if (holdBalance) await holdBalance;
      return { accountId: "fixture", coins, stars: 9 };
    }, operation: async (_token, body) => {
      if (receipts.has(body.request_id)) return receipts.get(body.request_id);
      coins += body.kind === "credit" ? body.amount : -body.amount;
      const receipt = { ...body, currency: "LiDollCoin", balance: coins }; receipts.set(body.request_id, receipt);
      if (loseResponse) throw new WalletError("lost", "The response was lost. Retry the saved payment.");
      return receipt;
    } });
  wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run("fixture", "fixture-token", Date.now() + 3600000, "fixture", "https://fixture.invalid/", "lidollbot");
  game = new HangmanStore(":memory:", wallet, hangmanConfig(), { words: [{ word: "BANANA", clue: "A yellow fruit you peel" }], draw: () => 0 });
  const sessions = new GameSessions(game.db, identities, { prefix: "hangman", command: "/hangman", ErrorClass: HangmanError });
  const config = { origin: "http://127.0.0.1", issuer: "https://auth.example" };
  server = createAuthServer(config, identities, {}, wallet, createHangmanWeb(config, game, sessions));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); config.origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, pipe: true });
  const page = await browser.newPage(), errors = [], violations = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
  page.setDefaultTimeout(15000); await page.setViewport({ width: 1360, height: 1100 });
  const idle = () => page.waitForFunction(() => !document.getElementById("refresh").disabled);
  const clickLetter = async letter => { await page.click(`[aria-label="Guess ${letter}"]`); await idle(); };
  const refresh = async () => { await page.click("#refresh"); await idle(); };
  await page.goto(`${config.origin}/hangman/open?ticket=${sessions.begin("fixture")}`);
  await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  await page.waitForFunction(() => !document.getElementById("game").hidden);
  assert.equal(await page.$eval("#balance", node => node.textContent), "20");
  holdBalance = new Promise(resolve => { releaseBalance = resolve; });
  await page.click("#start");
  await page.waitForFunction(() => document.querySelectorAll(".letter").length === 6);
  assert.equal(coins, 19); // The paid board appears before the deliberately stalled wallet refresh.
  holdBalance = null; releaseBalance(); await idle();
  await page.keyboard.press("a"); await idle();
  assert.equal(coins, 22); assert.equal(await page.$eval("#earned", node => node.textContent), "3 coins earned this round ✧");
  assert.equal(await page.$eval('[aria-label="Guess A"]', node => node.disabled), true);
  await clickLetter("Z"); assert.equal(coins, 22); assert.equal(await page.$$eval(".spent", nodes => nodes.length), 1);
  await page.reload(); await page.waitForFunction(() => !document.getElementById("game").hidden);
  assert.equal(await page.$eval("#earned", node => node.textContent), "3 coins earned this round ✧");
  if (process.env.HANGMAN_SCREENSHOT_DIR) {
    await mkdir(process.env.HANGMAN_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.HANGMAN_SCREENSHOT_DIR, "hangman-desktop.png"), fullPage: true });
  }
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.HANGMAN_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.HANGMAN_SCREENSHOT_DIR, "hangman-mobile.png"), fullPage: true });
  loseResponse = true; await clickLetter("N");
  assert.equal(coins, 24); assert.equal(await page.$eval("#pending", node => node.hidden), false);
  assert.equal(await page.$eval('[aria-label="Guess B"]', node => node.disabled), true);
  loseResponse = false; const count = receipts.size;
  await page.click("#retry"); await idle(); assert.equal(coins, 24); assert.equal(receipts.size, count);
  await clickLetter("B"); assert.equal(coins, 25);
  assert.match(await page.$eval("#board-title", node => node.textContent), /found your word/);
  coins = 0; await refresh(); assert.equal(await page.$eval("#start", node => node.disabled), true);
  assert.match(await page.$eval("#controls-note", node => node.textContent), /need 1 LiDollcoin/);
  coins = 20; balanceFailure = true; await refresh(); assert.equal(await page.$eval("#start", node => node.disabled), true);
  assert.match(await page.$eval("#controls-note", node => node.textContent), /wallet is unavailable/);
  balanceFailure = false; await refresh();
  await page.evaluate(() => { window.originalUUID = crypto.randomUUID; crypto.randomUUID = () => { throw Error("fixture"); }; });
  await page.click("#start"); await idle(); assert.equal(coins, 20);
  assert.match(await page.$eval("#notice", node => node.textContent), /Nothing was sent/);
  await page.evaluate(() => { crypto.randomUUID = undefined; });
  await page.click("#start"); await idle(); assert.equal(coins, 19);
  await page.click("#forfeit"); await page.waitForSelector("#leave-dialog[open]");
  await page.click("#leave-cancel"); assert.equal(game.active("fixture").status, "active");
  await page.click("#forfeit"); await page.click("#leave-confirm"); await idle();
  assert.equal(game.snapshot("fixture").round.status, "forfeited"); assert.equal(coins, 19);
  await page.click("#logout"); await page.waitForFunction(() => document.getElementById("game").hidden && document.getElementById("notice").textContent.includes("/hangman"));
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  console.log("PASS: Private handoff, 1-coin entry, per-occurrence rewards, wrong guesses, saved rounds, recovery, win/forfeit and logout in Chrome.");
  console.log("PASS: Desktop/mobile fit, keyboard input, low funds, balance failures, request preparation recovery and immediate paid board. No real coins used.");
} finally {
  holdBalance = null; releaseBalance?.(); await browser?.close();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await wallet?.close(); game?.close(); identities.close();
}
