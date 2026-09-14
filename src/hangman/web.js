import { readFileSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HangmanError } from "./store.js";
import { WalletError } from "../wallet/client.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function createHangmanWeb(config, game, sessions) {
  const secure = config.origin.startsWith("https:"), prefix = secure ? "__Host-" : "";
  const sessionName = `${prefix}hangman_session`, formName = `${prefix}hangman_form`;
  const cookie = (name, value, age) => `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const readCookie = (request, name) => (request.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  const files = new Map(["app.js", "style.css", "index.html"].map(name => [`/hangman/${name}`, readFileSync(new URL(`./web/${name}`, import.meta.url))]));
  files.set("/hangman/atelier.css", readFileSync(new URL("../gacha/web/style.css", import.meta.url))); // Reuse the established pastel theme without requiring an atelier session.
  const send = (response, status, body, type = "text/html") => { response.writeHead(status, { "Content-Type": `${type}; charset=utf-8` }); response.end(body); };
  const json = (response, status, data) => send(response, status, JSON.stringify(data), "application/json");
  const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cozy Hangman · LiDollBot</title><link rel="stylesheet" href="/hangman/atelier.css"><link rel="stylesheet" href="/hangman/style.css"></head><body class="handoff"><main class="handoff-card"><p class="eyebrow">✦ A LITTLE WORD GARDEN</p><h1>Cozy Hangman</h1>${body}</main></body></html>`;
  const body = async request => {
    let size = 0; const parts = [];
    for await (const part of request) { size += part.length; if (size > 8192) throw new HangmanError("This request is too large."); parts.push(part); }
    return Buffer.concat(parts).toString("utf8");
  }; // Bound both handoff forms and game action bodies before parsing them.
  return async (request, response) => {
    const url = new URL(request.url, config.origin);
    if (!url.pathname.startsWith("/hangman/") && url.pathname !== "/hangman") return false;
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (url.origin !== config.origin) throw new HangmanError("Invalid origin.");
      if (files.has(url.pathname) && ["GET", "HEAD"].includes(request.method)) {
        response.setHeader("Cache-Control", "no-cache");
        send(response, 200, request.method === "HEAD" ? "" : files.get(url.pathname), url.pathname.endsWith(".css") ? "text/css" : url.pathname.endsWith(".js") ? "text/javascript" : "text/html"); return true;
      }
      if (url.pathname === "/hangman/open") {
        if (request.method === "GET") {
          const ticket = url.searchParams.get("ticket");
          if (!sessions.ticket(ticket)) throw new HangmanError("This link expired or was used. Run /hangman in Discord for a fresh link.");
          const nonce = randomBytes(32).toString("base64url");
          response.setHeader("Set-Cookie", cookie(formName, nonce, 600)); response.setHeader("Referrer-Policy", "origin");
          send(response, 200, page(`<p>A cozy word is waiting. Each game costs <strong>1 LiDollcoin</strong>. Find a letter and earn <strong>1 coin for each place it appears</strong>.</p><form method="post" action="/hangman/open"><input type="hidden" name="ticket" value="${ticket}"><input type="hidden" name="csrf" value="${hash(`${ticket}:${nonce}`)}"><button class="primary" type="submit">Open my word garden →</button></form><p class="muted">Opening the page is free. This signs this browser in for eight hours. Keep your private Discord link to yourself.</p>`)); return true;
        }
        if (request.method === "POST") {
          const nonce = readCookie(request, formName);
          if (request.headers.origin !== config.origin || request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded" || !/^[\w-]{43}$/.test(nonce || "")) throw new HangmanError("Reopen your Discord link and use its Open my word garden button.");
          const form = new URLSearchParams(await body(request)), ticket = form.get("ticket");
          if (!equal(form.get("csrf"), hash(`${ticket}:${nonce}`))) throw new HangmanError("The browser could not verify this form. Reopen your Discord link.");
          const token = sessions.open(ticket);
          response.writeHead(303, { Location: "/hangman/", "Set-Cookie": [cookie(sessionName, token, 8 * 3600), cookie(formName, "", 0)] }); response.end(); return true;
        }
      }
      if (["/hangman", "/hangman/"].includes(url.pathname) && request.method === "GET") { send(response, 200, files.get("/hangman/index.html")); return true; }
      if (url.pathname.startsWith("/hangman/api/")) {
        const session = sessions.get(readCookie(request, sessionName));
        if (!session) { json(response, 401, { error: "Use LiD0llID sign-in above, or run /hangman in Discord and open its private link." }); return true; }
        if (url.pathname === "/hangman/api/state" && request.method === "GET") {
          let coins = null, walletError = null;
          try { coins = (await game.wallet.balance(session.user_id)).coins; }
          catch (error) { walletError = error instanceof WalletError ? error.message : "Your wallet is temporarily unavailable. Press Refresh to try again."; }
          json(response, 200, { ...game.snapshot(session.user_id), username: session.username, csrf: session.csrf, coins, walletError }); return true;
        }
        if (request.method === "POST") {
          if (request.headers.origin !== config.origin || !equal(request.headers["x-csrf-token"], session.csrf) || request.headers["content-type"]?.split(";")[0] !== "application/json") {
            json(response, 403, { error: "This browser could not verify the action. Refresh your game." }); return true;
          }
          if (url.pathname === "/hangman/api/logout") {
            sessions.revoke(session.user_id); response.setHeader("Set-Cookie", cookie(sessionName, "", 0)); json(response, 200, { ok: true }); return true;
          }
          if (url.pathname === "/hangman/api/action") {
            let input; try { input = JSON.parse(await body(request)); } catch { throw new HangmanError("Invalid game request."); }
            if (!input || typeof input !== "object" || Array.isArray(input)) throw new HangmanError("Invalid game request.");
            const result = input.action === "retry" ? await game.retry(session.user_id) : await game.act(session.user_id, input);
            json(response, 200, result); return true;
          }
        }
      }
      send(response, 404, page('<p>That page is not here. <a href="/hangman/">Return to your word garden</a>.</p>'));
    } catch (error) {
      const message = error instanceof HangmanError || error instanceof WalletError ? error.message : "The game is temporarily unavailable. Refresh and retry any pending payment.";
      if (url.pathname.startsWith("/hangman/api/")) json(response, 400, { error: message });
      else send(response, 400, page(`<p>${escape(message)}</p>`));
    }
    return true;
  }; // Every mutation uses the confirmed Discord identity, exact origin and session CSRF; wallet grants never reach browsers.
}
