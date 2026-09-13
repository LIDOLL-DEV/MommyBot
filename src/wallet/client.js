export class WalletError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
} // Carry safe, locally authored errors instead of exposing provider responses or bearer credentials.

const messages = {
  invalid_client: "LiDollBot is not registered with Little Log's wallet API. Ask Doll to add the lidollbot wallet app.",
  invalid_token: "Your online wallet connection expired or was revoked. Use /lidollid wallet connect again.",
  insufficient_scope: "Reconnect your online wallet and approve the requested star and coin permissions.",
  authorization_pending: "Wallet approval is still waiting. Approve the code in Little Log, then press Check approval.",
  slow_down: "Please wait before checking wallet approval again.",
  access_denied: "Wallet permission was declined or the account is disabled. Start a new connection if needed.",
  expired_token: "This wallet approval code expired or was already used. Start a new connection.",
  daily_limit: "The wallet app's daily limit has been reached. Try again tomorrow.",
};

export function walletConfig(env = process.env) {
  if (env.LIDOLLCOIN_ENABLED !== "true") return null;
  const base = new URL(env.LIDOLLCOIN_API_URL || "https://lidoll.dev/tracker/api/lidollcoin/v1/");
  const local = env.NODE_ENV !== "production" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  if ((base.protocol !== "https:" && !(local && base.protocol === "http:")) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith("/")) {
    throw new Error("LIDOLLCOIN_API_URL requires an HTTPS base URL ending in / (loopback HTTP is allowed for development).");
  }
  const clientId = env.LIDOLLCOIN_CLIENT_ID || "lidollbot";
  if (!/^[a-z0-9_-]{1,64}$/.test(clientId)) throw new Error("Invalid LIDOLLCOIN_CLIENT_ID.");
  return { baseUrl: base.href, clientId };
} // Treat wallet registration independently from the OIDC client, even when both are named lidollbot.

export class WalletClient {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  async request(route, { token, body } = {}) {
    const url = new URL(route, this.config.baseUrl);
    url.searchParams.set("client_id", this.config.clientId);
    let response, data;
    try {
      response = await this.fetcher(url, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      data = await response.json();
    } catch { throw new WalletError("unavailable", "The online wallet could not be reached. Please try again."); }
    if (!response.ok) {
      const code = Object.hasOwn(messages, data?.error) ? data.error : response.status === 401 ? "invalid_token" : "request_failed";
      throw new WalletError(code, messages[code] || "The online wallet refused this request. Check your balance and try again.", response.status);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new WalletError("invalid_response", "The online wallet returned an invalid response.");
    return data;
  } // Never follow redirects with credentials or log provider error bodies; timeouts remain uncertain outcomes for writes.
  async begin() {
    const data = await this.request("device", { body: { scope: "wallet:read wallet:write stars:read stars:write" } });
    let verification;
    try { verification = new URL(data.verification_uri); } catch { /* The validation below rejects malformed verification URLs. */ }
    if (!/^[\w-]{20,100}$/.test(data.device_code || "") || !/^[A-Z0-9-]{6,32}$/.test(data.user_code || "") ||
        !Number.isInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 3600 ||
        !Number.isInteger(data.interval) || data.interval < 1 || data.interval > 60 ||
        verification?.origin !== new URL(this.config.baseUrl).origin || verification.username || verification.password || verification.hash || verification.search) {
      throw new WalletError("invalid_response", "The wallet approval response was invalid.");
    }
    return data;
  } // Only show a verification link on the configured wallet service's origin.
  async poll(deviceCode) {
    const data = await this.request("token", { body: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode } });
    if (!/^[\w-]{20,100}$/.test(data.access_token || "") || data.token_type !== "Bearer" ||
        !Number.isInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 2592000 ||
        !["wallet:read", "wallet:write", "stars:read", "stars:write"].every(scope => String(data.scope).split(" ").includes(scope))) {
      throw new WalletError("invalid_response", "The wallet did not grant the required permissions. Reconnect and approve stars and coins.");
    }
    return data;
  }
  async balance(token) {
    const data = await this.request("wallet", { token });
    if (!/^[\w-]{1,128}$/.test(data.account_id || "") || ![data.balance, data.stars].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) || data.stars_enabled !== true) {
      throw new WalletError("invalid_response", "The wallet did not return both star and coin balances with spending permission. Reconnect your wallet.");
    }
    return { accountId: data.account_id, coins: data.balance, stars: data.stars };
  } // Return fresh balances without copying them into the local trader wallet.
  operation(token, body) { return this.request("operations", { token, body }); }
  revoke(token) { return this.request("revoke", { token, body: {} }); }
}
