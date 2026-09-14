import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createAuthServer } from "../src/auth/server.js";
import { createLeaderboardWeb } from "../src/leaderboard/web.js";

if (!process.env.PUPPETEER_MODULE || !process.env.CHROME_PATH) throw new Error("Set PUPPETEER_MODULE and CHROME_PATH to your local browser tooling.");
const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const config = { origin: "http://127.0.0.1", issuer: "https://fixture.invalid" };
const names = ["Rosie", "Luna", "Peach", "Clover", "Daisy", "Mochi", '<img src=x onerror="alert(1)">'];
let entries = names.map((username, i) => ({ username, coins: i === 6 ? null : 12500 - i * 1700, rank: i === 6 ? null : i + 1, checkedAt: new Date().toISOString() }));
let fail = false;
const route = createLeaderboardWeb(config, { snapshot: async () => {
  if (fail) throw new Error("Synthetic unavailable provider");
  return { entries, updatedAt: new Date().toISOString(), refreshAfterSeconds: 60 };
} }); // Exercise the real page and HTTP composition with invented names and balances only.
const server = createAuthServer(config, {}, {}, null, route);
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  config.origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, pipe: true });
  const page = await browser.newPage(), errors = [], violations = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
  await page.setViewport({ width: 1280, height: 1100 });
  await page.goto(`${config.origin}/leaderboard/`);
  const idle = () => page.waitForFunction(() => !document.getElementById("refresh").disabled);
  await idle();
  assert.equal(await page.$$eval("#players tr", rows => rows.length), 7);
  assert.equal(await page.$$eval("#podium article", cards => cards.length), 3);
  assert.equal(await page.$eval("#players tr:last-child td:nth-child(2)", cell => cell.textContent), names[6]);
  assert.equal(await page.$$eval("#players img", images => images.length), 0);
  await page.type("#search", "luna");
  assert.equal(await page.$$eval("#players tr", rows => rows.length), 1);
  assert.equal(await page.$eval("#players td", cell => cell.textContent), "#2");
  await page.$eval("#search", input => { input.value = "nobody"; input.dispatchEvent(new Event("input")); });
  assert.equal(await page.$eval("#empty", el => !el.hidden), true);
  await page.$eval("#search", input => { input.value = ""; input.dispatchEvent(new Event("input")); });
  if (process.env.LEADERBOARD_SCREENSHOT_DIR) {
    await mkdir(process.env.LEADERBOARD_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.LEADERBOARD_SCREENSHOT_DIR, "leaderboard-desktop.png"), fullPage: true });
  }
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.LEADERBOARD_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.LEADERBOARD_SCREENSHOT_DIR, "leaderboard-mobile.png"), fullPage: true });
  fail = true; await page.click("#refresh"); await idle();
  assert.match(await page.$eval("#notice", el => el.textContent), /Previously loaded/);
  assert.equal(await page.$$eval("#players tr", rows => rows.length), 7);
  fail = false; entries = [{ username: "A".repeat(100), coins: 2147483647, rank: 1, checkedAt: new Date().toISOString() }];
  await page.click("#refresh"); await idle();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  entries = []; await page.click("#refresh"); await idle();
  assert.equal(await page.$eval("#podium", el => el.hidden), true);
  assert.match(await page.$eval("#empty", el => el.textContent), /first player/);
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  console.log("PASS: leaderboard desktop/mobile layout, podium, search, literal player names, unavailable balances, failed refresh recovery and empty state. No real accounts or coins.");
} finally {
  await browser?.close();
  if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
} // Always close the fixture browser and loopback listener after checks or failures.
