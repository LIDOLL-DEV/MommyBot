import { createServer } from "node:http";

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function createAuthServer(config, store, oidc) {
  const secure = config.origin.startsWith("https:");
  const cookieName = secure ? "__Host-lidollbot_login" : "lidollbot_login";
  const cookie = (value, age) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const page = (response, status, body) => {
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LiDollBot account</title><body><main><h1>LiDollBot · LiD0llID</h1>${body}</main></body></html>`);
  }; // Render escaped server-side text with no scripts, third-party assets or browser token storage.
  return createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      if (request.method !== "GET") { response.setHeader("Allow", "GET"); return page(response, 405, "<p>Method not allowed.</p>"); }
      const url = new URL(request.url, config.origin);
      if (url.origin !== config.origin) return page(response, 400, "<p>Invalid request.</p>");
      if (url.pathname === "/") return page(response, 200, "<p>Use <strong>/lidollid login</strong> in Discord to connect your account.</p>");
      if (url.pathname === "/auth/login") {
        const ticket = url.searchParams.get("ticket");
        if (!/^[\w-]{43}$/.test(ticket || "") || !store.hasTicket(ticket)) return page(response, 400, "<p>Login link invalid, expired or already used. Start with /lidollid login in Discord.</p>");
        const login = await oidc.begin();
        const browser = store.start(ticket, login.values);
        response.writeHead(303, { Location: login.url, "Set-Cookie": cookie(browser, 600) });
        return response.end();
      }
      if (url.pathname === "/auth/callback") {
        const browser = (request.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        response.setHeader("Set-Cookie", cookie("", 0));
        const attempt = store.take(browser);
        if (!attempt) return page(response, 400, "<p>Login expired or already used. Run /lidollid login again.</p>");
        const identity = await oidc.finish(url, attempt);
        const code = store.verified(attempt, identity);
        return page(response, 200, `<p>Signed in as <strong>${escapeHtml(identity.username)}</strong>.</p><p>To link this account, return to the Discord account that started sign-in and run:</p><pre>/lidollid confirm code:${code}</pre><p>Only confirm a sign-in you started yourself. The code expires ten minutes after you started. You can close this page afterward.</p>`);
      }
      return page(response, 404, "<p>Page not found.</p>");
    } catch {
      // Avoid logging URLs, authorization codes, cookies or provider responses containing credentials.
      console.error("[LiD0llID] Sign-in failed; restart sign-in and check provider availability/client registration.");
      return page(response, 503, "<p>Sign-in could not be completed. Run /lidollid login again in Discord. If this continues, ask the bot operator to check LiD0llID availability and callback registration.</p>");
    }
  });
} // Expose only the browser handoff; account reads and changes require authenticated Discord interactions.
