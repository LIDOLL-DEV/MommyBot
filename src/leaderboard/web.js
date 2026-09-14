import { readFileSync } from "node:fs";

const accountKey = account => JSON.stringify([account.key, account.players]); // Internal cache keys never enter the public response.

export class CoinLeaderboard {
  constructor(identities, wallet, { now = Date.now } = {}) {
    this.identities = identities; this.wallet = wallet; this.now = now;
    this.cache = null; this.pending = null;
  } // Share one short-lived, in-memory snapshot across visitors without writing currency to SQLite.

  async refresh(accounts, key) {
    const entries = new Map();
    let cursor = 0;
    const worker = async () => {
      while (cursor < accounts.length) {
        const account = accounts[cursor++];
        let coins = null;
        for (const player of account.players) {
          try {
            const balance = await this.wallet.readBalance(player);
            if (!Number.isSafeInteger(balance.coins) || balance.coins < 0) continue;
            coins = balance.coins; break;
          } catch { /* Missing, expired or unavailable grants leave an honest unranked entry. */ }
        }
        entries.set(accountKey(account), { coins, checkedAt: coins === null ? null : new Date(this.now()).toISOString() });
      }
    }; // Fall back to another registration of the same identity without counting that identity twice.
    await Promise.all(Array.from({ length: Math.min(4, accounts.length) }, worker));
    this.cache = { key, entries, expires: this.now() + 60_000, updatedAt: new Date(this.now()).toISOString() };
  } // Bound provider concurrency and cache failed reads too, so repeated refresh clicks cannot flood the wallet API.

  async snapshot() {
    while (true) {
      if (this.pending) { await this.pending; continue; }
      const accounts = this.identities.leaderboardAccounts();
      const key = JSON.stringify(accounts.map(accountKey));
      if (this.cache && this.cache.key === key && this.cache.expires > this.now()) break;
      this.pending = this.refresh(accounts, key);
      try { await this.pending; } finally { this.pending = null; }
    } // Recheck the roster after waiting so visitors share one refresh even when registrations change mid-read.
    const entries = this.identities.leaderboardAccounts().map(account => ({
      username: account.username, ...(this.cache.entries.get(accountKey(account)) || { coins: null, checkedAt: null }),
    })); // Re-read registrations after network awaits; unlinked or replaced identities cannot survive in a cached response.
    entries.sort((a, b) => (b.coins ?? -1) - (a.coins ?? -1) || a.username.localeCompare(b.username));
    let rank = null;
    entries.forEach((entry, index) => {
      if (entry.coins !== null && (index === 0 || entry.coins !== entries[index - 1].coins)) rank = index + 1;
      entry.rank = entry.coins === null ? null : rank;
    }); // Equal balances share competition ranks; unknown balances never masquerade as zero coins.
    return { entries, updatedAt: this.cache.updatedAt, refreshAfterSeconds: 60 };
  } // Publish only display names, coin counts, ranks and timestamps, across registered MommyBot accounts.
}

export function createLeaderboardWeb(config, leaderboard) {
  const files = new Map(["index.html", "style.css", "app.js"].map(name => [
    `/leaderboard/${name}`, readFileSync(new URL(`./web/${name}`, import.meta.url)),
  ]));
  return async (request, response) => {
    const url = new URL(request.url, config.origin);
    if (url.pathname !== "/leaderboard" && !url.pathname.startsWith("/leaderboard/")) return false;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const send = (status, body, type = "text/plain") => {
      response.writeHead(status, { "Content-Type": `${type}; charset=utf-8` });
      response.end(request.method === "HEAD" ? undefined : body);
      return true;
    }; // Apply the same read-only response headers to the page, static assets, API and failures.
    if (url.origin !== config.origin) return send(400, "Invalid origin.");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD"); return send(405, "Method not allowed.");
    }
    if (url.pathname === "/leaderboard/api/balances") {
      if (request.method === "HEAD") return send(200, "", "application/json");
      try { return send(200, JSON.stringify(await leaderboard.snapshot()), "application/json"); }
      catch { return send(503, JSON.stringify({ error: "The coin garden is resting. Please try Refresh again shortly." }), "application/json"); }
    }
    const path = ["/leaderboard", "/leaderboard/"].includes(url.pathname) ? "/leaderboard/index.html" : url.pathname;
    if (!files.has(path)) return send(404, "Page not found.");
    return send(200, files.get(path), path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "text/html");
  }; // Expose the requested public leaderboard on the existing bot origin; no login, payment or bearer token reaches the browser.
}
