import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { IdentityStore } from "../src/auth/store.js";
import { createAuthServer } from "../src/auth/server.js";

if (!process.env.PUPPETEER_MODULE || !process.env.CHROME_PATH) {
  throw new Error("Set PUPPETEER_MODULE to puppeteer-core's entry file and CHROME_PATH to a Chrome/Chromium executable.");
}
const puppeteer = (await import(pathToFileURL(process.env.PUPPETEER_MODULE).href)).default;
const store = new IdentityStore(":memory:");
let browser, server, provider, brokenPolicy = true, attempts = 0;
const submissions = [], providerReferrers = [];
const config = { origin: "http://127.0.0.1" };
const listen = async target => {
  await new Promise((resolve, reject) => { target.once("error", reject); target.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${target.address().port}`;
}; // Use disposable loopback servers and in-memory identities, never live accounts or production settings.
const close = async target => {
  if (!target?.listening) return;
  target.closeAllConnections();
  await new Promise(resolve => target.close(resolve));
};

try {
  provider = createServer((request, response) => {
    providerReferrers.push(request.headers.referer);
    response.writeHead(303, { Location: `${config.origin}/auth/callback?code=fixture-code&state=fixture-state`, "Cache-Control": "no-store" });
    response.end();
  });
  config.issuer = await listen(provider);
  server = createAuthServer(config, store, {
    begin: async () => {
      attempts++;
      return { values: { verifier: "fixture-verifier", nonce: "fixture-nonce", state: "fixture-state" }, url: `${config.issuer}/authorize` };
    },
    finish: async (url, attempt) => {
      assert.equal(url.searchParams.get("state"), attempt.state);
      assert.equal(attempt.verifier, "fixture-verifier");
      return { issuer: config.issuer, subject: "fixture-account", username: "Browser test" };
    }, // Existing Node tests verify real signed OIDC responses; this fixture isolates browser navigation, cookies, CSP and headers.
  });
  server.prependListener("request", (request, response) => {
    if (request.method === "POST") submissions.push({ origin: request.headers.origin, referer: request.headers.referer });
    const setHeader = response.setHeader;
    response.setHeader = function (name, value) {
      return setHeader.call(this, name, brokenPolicy && name.toLowerCase() === "referrer-policy" ? "no-referrer" : value);
    }; // Reproduce the former policy before exercising exactly the production fix.
  });
  config.origin = await listen(server);
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, pipe: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const screenshotDir = process.env.AUTH_SCREENSHOT_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const checkAppearance = async name => {
    for (const width of [390, 1280]) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      const layout = await page.evaluate(() => ({
        color: getComputedStyle(document.documentElement).color,
        fits: document.documentElement.scrollWidth <= window.innerWidth,
        rounded: getComputedStyle(document.querySelector("main")).borderRadius,
      }));
      assert.equal(layout.color, "rgb(86, 59, 104)", "CSP must allow the bundled tracker theme.");
      assert.equal(layout.rounded, "24px");
      assert.ok(layout.fits, `${name} must fit a ${width}px viewport, including its confirmation command.`);
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}-${width}.png`), fullPage: true });
    }
  }; // Check actual browser styling and mobile overflow; optional captures contain only disposable fixture credentials.
  const ticket = store.begin("fixture-discord-user");
  const login = `${config.origin}/auth/login?ticket=${ticket}`;
  await page.goto(login);
  const [rejected] = await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  assert.equal(rejected.status(), 403);
  assert.equal(submissions.at(-1).origin, "null");
  assert.equal(store.hasTicket(ticket), true);
  assert.equal(attempts, 0);
  await checkAppearance("error");
  console.log("PASS: Reproduced the old no-referrer form failure (Origin: null, HTTP 403).");

  brokenPolicy = false;
  await page.goto(login);
  await checkAppearance("login");
  const [accepted] = await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  assert.equal(accepted.status(), 200);
  assert.equal(new URL(page.url()).pathname, "/auth/callback");
  assert.equal(submissions.at(-1).origin, config.origin);
  assert.equal(submissions.at(-1).referer, `${config.origin}/`);
  assert.deepEqual(providerReferrers, [undefined]);
  assert.equal(attempts, 1);
  await checkAppearance("confirmation");
  const text = await page.$eval("main", element => element.textContent);
  const confirmation = text.match(/confirm code:([a-f0-9]{32})/)?.[1];
  assert.ok(confirmation, "Browser must reach the Discord confirmation page.");
  assert.equal(store.get("fixture-discord-user"), undefined);
  store.confirm("fixture-discord-user", confirmation);
  assert.equal(store.get("fixture-discord-user").subject, "fixture-account");
  console.log("PASS: Corrected policy preserves Origin, strips ticket from Referer, follows provider redirect, and permits Discord confirmation.");
  console.log("PASS: Login, error and confirmation pages apply the tracker theme and fit mobile and desktop viewports.");
} finally {
  await browser?.close();
  await close(server);
  await close(provider);
  store.close();
}
