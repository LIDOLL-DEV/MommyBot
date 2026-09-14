import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { IdentityStore } from "../src/auth/store.js";
import { createAuthServer } from "../src/auth/server.js";
import { WalletService } from "../src/wallet/service.js";
import { DiaperStore } from "../src/gacha/store.js";
import { loadDiaperCatalog } from "../src/gacha/catalog.js";
import { GachaSessions } from "../src/gacha/sessions.js";
import { createGachaWeb } from "../src/gacha/web.js";

if (!process.env.PUPPETEER_MODULE || !process.env.CHROME_PATH) throw new Error("Set PUPPETEER_MODULE and CHROME_PATH to your local browser tools.");
const puppeteer = (await import(pathToFileURL(process.env.PUPPETEER_MODULE).href)).default;
const identities = new IdentityStore(":memory:"), receipts = new Map();
let coins = 1000, browser, server, game, wallet;
try {
  const ticket = identities.begin("fixture-user"), callback = identities.start(ticket, { verifier: "v", state: "s", nonce: "n" });
  identities.confirm("fixture-user", identities.verified(identities.take(callback), { issuer: "https://auth.example", subject: "fixture", username: "Doll (preview)" }));
  wallet = new WalletService(":memory:", { config: { baseUrl: "https://fixture.invalid/", clientId: "lidollbot" },
    balance: async () => ({ accountId: "fixture-wallet", coins, stars: 9 }),
    operation: async (_token, body) => {
      if (receipts.has(body.request_id)) return receipts.get(body.request_id);
      coins += body.kind === "credit" ? body.amount : -body.amount;
      const receipt = { ...body, currency: "LiDollCoin", balance: coins };
      receipts.set(body.request_id, receipt); return receipt;
    } });
  wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run("fixture-user", "fixture-token", Date.now() + 3600000, "fixture-wallet", "https://fixture.invalid/", "lidollbot");
  const catalog = loadDiaperCatalog();
  game = new DiaperStore(":memory:", catalog, wallet, { price: 3, enabled: true }, () => 0);
  for (const [index, item] of catalog.entries()) {
    if (index % 3 === 0 || item.sprite) game.db.prepare("INSERT INTO diaper_items VALUES (?,?,?,NULL,?)").run(randomUUID(), item.id, "fixture-user", Date.now());
    if (index % 4 === 0) game.db.prepare("INSERT INTO diaper_items VALUES (?,?,NULL,NULL,?)").run(randomUUID(), item.id, Date.now());
  }
  const sessions = new GachaSessions(game.db, identities), config = { origin: "http://127.0.0.1", issuer: "https://auth.example" };
  server = createAuthServer(config, identities, {}, wallet, createGachaWeb(config, game, sessions));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); config.origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, pipe: true });
  const page = await browser.newPage(), errors = [], violations = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
  await page.setViewport({ width: 1360, height: 1100 });
  page.setDefaultTimeout(15000);
  await page.goto(`${config.origin}/diapers/open?ticket=${sessions.begin("fixture-user")}`);
  await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  await page.waitForFunction(() => !document.getElementById("game").hidden);
  assert.equal(await page.$eval("#balance", node => node.textContent), "1,000");
  const folder = process.env.DIAPER_SCREENSHOT_DIR;
  if (folder) await mkdir(folder, { recursive: true });
  const capture = async (name, width) => {
    await page.setViewport({ width, height: width < 600 ? 900 : 1100 });
    await page.evaluate(async () => { await Promise.all([...document.images].map(image => { image.loading = "eager"; return image.decode(); })); });
    await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); }); // Capture completed reveals, not an intermediate animation frame.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} must fit its viewport`);
    if (folder) await page.screenshot({ path: join(folder, `${name}-${width}.png`), fullPage: true });
  }; // Screenshots and gameplay use only generated fixture identities, in-memory inventory and a simulated wallet.
  await capture("machine", 1360);
  await page.click("#roll"); await page.waitForSelector("#reveal[open]");
  assert.equal(coins, 997); assert.equal(receipts.size, 1);
  await capture("reveal", 390); await page.click("#reveal-done");
  await page.click('[data-tab="collection"]');
  await capture("collection", 1360); await capture("collection", 390);
  await page.type("#search", "Cloud Tapes");
  await page.click('[data-purchase="sell"]');
  await page.waitForFunction(() => document.getElementById("notice").textContent.startsWith("Sold Cloud Tapes"));
  assert.equal(coins, 998);
  await page.click('[data-tab="bank"]'); await page.click('[data-purchase="buy"]');
  await page.waitForSelector("#reveal[open]"); assert.equal(coins, 996); assert.equal(receipts.size, 3);
  await page.click("#reveal-done");
  await page.$eval("#search", node => { node.value = ""; node.dispatchEvent(new Event("input")); });
  await capture("bank", 1360); await capture("bank", 390);
  await page.click('[data-tab="catalog"]');
  assert.equal(await page.$$eval(".diaper-card", cards => cards.length), 58);
  await page.select("#rarity", "legendary");
  assert.equal(await page.$$eval(".diaper-card", cards => cards.length), 3);
  await capture("legendary", 1360);
  await page.click("#logout"); await page.waitForFunction(() => !document.getElementById("signed-out").hidden);
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  console.log("PASS: Private handoff, paid roll, reveal, sale, bank buyback, rarity filters and logout work in Chrome.");
  console.log("PASS: Mobile/desktop pages fit their viewports with no script errors or CSP violations. No real coins were spent.");
} finally {
  await browser?.close();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await wallet?.close(); game?.close(); identities.close();
}
