export function authConfig(env = process.env) {
  if (env.LIDOLLID_ENABLED !== "true") return null;
  const checked = (value, label) => {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && local && url.protocol === "http:"))) {
      throw new Error(`${label} requires HTTPS (HTTP loopback is allowed for development only).`);
    }
    return url;
  }; // Validate trusted configuration instead of deriving redirects from request headers.
  const origin = checked(env.LIDOLLID_PUBLIC_ORIGIN, "LIDOLLID_PUBLIC_ORIGIN");
  if (origin.pathname !== "/") throw new Error("LIDOLLID_PUBLIC_ORIGIN must be an origin without a path.");
  const issuer = checked(env.LIDOLLID_ISSUER || "https://auth.sadgirlsclub.wtf", "LIDOLLID_ISSUER");
  const clientId = env.LIDOLLID_CLIENT_ID || "lidollbot";
  if (!/^[a-z0-9_-]{1,80}$/.test(clientId)) throw new Error("Invalid LIDOLLID_CLIENT_ID.");
  const port = Number(env.LIDOLLID_PORT || 4190);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid LIDOLLID_PORT.");
  return { origin: origin.origin, issuer: issuer.href, clientId, port,
    host: env.LIDOLLID_HOST || "127.0.0.1", callback: `${origin.origin}/auth/callback` };
} // Keep SSO opt-in so existing deployments work until their callback is registered.
