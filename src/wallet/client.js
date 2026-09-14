import { isIP } from "node:net";

export class WalletError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
} // Carry safe, locally authored errors instead of exposing provider responses or bearer credentials.

const transportCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH",
  "EACCES", "EPERM", "EADDRNOTAVAIL", "EPROTO", "ERR_SSL_WRONG_VERSION_NUMBER", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]);

function transportCode(error) {
  const pending = [error], seen = new Set();
  for (let count = 0; pending.length && count < 32; count++) {
    const cause = pending.shift();
    if (!cause || seen.has(cause)) continue;
    seen.add(cause);
    if (transportCodes.has(cause.code)) return cause.code;
    if (["TimeoutError", "AbortError"].includes(cause.name)) return "REQUEST_TIMEOUT";
    if (cause.cause) pending.push(cause.cause);
    if (Array.isArray(cause.errors)) pending.push(...cause.errors.slice(0, 8));
  }
  return "NETWORK_ERROR";
} // Inspect Node's aggregate connection failures as well as causes, without exposing messages, addresses or credentials.

const messages = {
  invalid_client: "LiDollBot is not registered with Little Log's wallet API. Ask Doll to add the lidollbot wallet app.",
  invalid_token: "Your online wallet connection expired or was revoked. Use /lidollid wallet connect again.",
  insufficient_scope: "Reconnect your online wallet and approve the requested coin, star and diamond permissions.",
  authorization_pending: "Wallet approval is still waiting. Approve the code in Little Log, then press Check approval.",
  slow_down: "Please wait before checking wallet approval again.",
  access_denied: "Wallet permission was declined or the account is disabled. Start a new connection if needed.",
  expired_token: "This wallet approval code expired or was already used. Start a new connection.",
  daily_limit: "The wallet app's daily limit has been reached. Try again tomorrow.",
};

function privateHost(host) {
  if (["localhost", "[::1]"].includes(host)) return true;
  if (isIP(host) !== 4) return false;
  const [first, second] = host.split(".").map(Number);
  return first === 127 || first === 10 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
} // Permit direct HTTP only to loopback or literal RFC1918 addresses explicitly configured by the operator.

export function walletConfig(env = process.env) {
  if (env.LIDOLLCOIN_ENABLED !== "true") return null;
  const base = new URL(env.LIDOLLCOIN_API_URL || "https://lidoll.dev/tracker/api/lidollcoin/v1/");
  if ((base.protocol !== "https:" && !(privateHost(base.hostname) && base.protocol === "http:")) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith("/")) {
    throw new Error("LIDOLLCOIN_API_URL must end in / and use HTTPS, or HTTP to a loopback/private IPv4 address.");
  }
  const publicUrl = new URL(env.LIDOLLCOIN_PUBLIC_ORIGIN || (base.protocol === "https:" ? base.origin : "https://lidoll.dev"));
  const developmentBrowser = env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname) && publicUrl.protocol === "http:";
  if ((publicUrl.protocol !== "https:" && !developmentBrowser) || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== "/") {
    throw new Error("LIDOLLCOIN_PUBLIC_ORIGIN must be the public HTTPS origin for Little Log's approval page.");
  }
  const clientId = env.LIDOLLCOIN_CLIENT_ID || "lidollbot";
  if (!/^[a-z0-9_-]{1,64}$/.test(clientId)) throw new Error("Invalid LIDOLLCOIN_CLIENT_ID.");
  return { baseUrl: base.href, clientId, verificationOrigin: publicUrl.origin };
} // Treat wallet registration independently from the OIDC client, even when both are named lidollbot.

export class WalletClient {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  async request(route, { token, body } = {}) {
    const url = new URL(route, this.config.baseUrl);
    url.searchParams.set("client_id", this.config.clientId);
    let response, data;
    try {
      response = await this.fetcher(url, { method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (error) {
      throw new WalletError("unavailable", `The online wallet could not be reached (${transportCode(error)}). Ask Doll to check the wallet URL, DNS, TLS and outbound access from the bot host.`);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new WalletError("redirect", `The wallet API redirected this request (HTTP ${response.status}). Ask Doll to check LIDOLLCOIN_API_URL and the Nginx API route.`, response.status);
    } // Inspect redirects without following them or disclosing a Location header that may contain a credential.
    try { data = await response.json(); }
    catch {
      throw new WalletError("invalid_response", `The wallet server did not return JSON (HTTP ${response.status}). Ask Doll to check Nginx and lidoll-tracker. A pending payment must be retried, not purchased again.`);
    } // An HTML proxy error is not a definitive payment rejection; leave its financial status uncertain.
    if (!response.ok) {
      const code = Object.hasOwn(messages, data?.error) ? data.error : response.status === 401 ? "invalid_token" : "request_failed";
      throw new WalletError(code, messages[code] || "The online wallet refused this request. Check your balance and try again.", response.status);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new WalletError("invalid_response", "The online wallet returned an invalid response.");
    return data;
  } // Never follow redirects with credentials or log provider error bodies; timeouts remain uncertain outcomes for writes.
  async begin() {
    const data = await this.request("device", { body: { scope: "wallet:read wallet:write stars:read stars:write diamonds:read diamonds:write" } });
    let verification;
    try { verification = new URL(data.verification_uri); } catch { /* The validation below rejects malformed verification URLs. */ }
    if (!/^[\w-]{20,100}$/.test(data.device_code || "") || !/^[A-Z0-9-]{6,32}$/.test(data.user_code || "") ||
        !Number.isInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 3600 ||
        !Number.isInteger(data.interval) || data.interval < 1 || data.interval > 60 ||
        verification?.origin !== this.config.verificationOrigin || verification.username || verification.password || verification.hash || verification.search) {
      throw new WalletError("invalid_response", "The wallet approval response was invalid.");
    }
    return data;
  } // The API may use a private backend, while players approve only on the configured public browser origin.
  async poll(deviceCode) {
    const data = await this.request("token", { body: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode } });
    if (!/^[\w-]{20,100}$/.test(data.access_token || "") || data.token_type !== "Bearer" ||
        !Number.isInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 2592000 ||
        !["wallet:read", "wallet:write", "stars:read", "stars:write", "diamonds:read", "diamonds:write"].every(scope => String(data.scope).split(" ").includes(scope))) {
      throw new WalletError("invalid_response", "The wallet did not grant the required permissions. Reconnect and approve coins, stars and diamonds.");
    }
    return data;
  }
  async exchange(proof) { // Use the internal API address; only a consented OIDC access token can authorize this exchange.
    const data=await this.request('exchange',{body:{grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token_type:'urn:ietf:params:oauth:token-type:access_token',subject_token:proof}});
    if(!/^[\w-]{20,100}$/.test(data.access_token||'')||data.token_type!=='Bearer'||!Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>2592000||!['wallet:read','wallet:write','stars:read','stars:write','diamonds:read','diamonds:write'].every(s=>String(data.scope).split(' ').includes(s))||typeof data.identity?.issuer!=='string'||typeof data.identity?.subject!=='string')throw new WalletError('invalid_response','The login did not grant account and wallet access. Start /lidollid login again.');
    return data;
  }
  async balance(token) {
    const data = await this.request("wallet", { token });
    if (!/^[\w-]{1,128}$/.test(data.account_id || "") || ![data.balance, data.stars].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) || data.stars_enabled !== true) {
      throw new WalletError("invalid_response", "The wallet did not return both star and coin balances with spending permission. Reconnect your wallet.");
    }
    if(data.diamonds!==undefined&&(!Number.isSafeInteger(data.diamonds)||data.diamonds<0||data.diamonds>2147483647||typeof data.diamonds_enabled!=='boolean'))throw new WalletError('invalid_response','The wallet returned an invalid diamond balance.');
    return { accountId: data.account_id, coins: data.balance, stars: data.stars, diamonds:data.diamonds??null, diamondsEnabled:data.diamonds_enabled===true }; // Legacy grants keep working for coins/stars while clearly requiring consent to unlock diamonds.
  } // Return fresh balances without copying them into the local trader wallet.
  operation(token, body) { return this.request("operations", { token, body }); }
  revoke(token) { return this.request("revoke", { token, body: {} }); }
}
