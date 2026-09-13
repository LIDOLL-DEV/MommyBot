import * as oidc from "openid-client";
import { authStep } from "./diagnostics.js";

export function createOidc(config, combined = false) {
  let discovery;
  const configured = () => {
    discovery ??= authStep("discovery", () => oidc.discovery(new URL(config.issuer), config.clientId, undefined, oidc.None(), {
      execute: [...(config.issuer.startsWith("http:") ? [oidc.allowInsecureRequests] : []), oidc.enableNonRepudiationChecks],
      timeout: 15,
    })).catch(error => { discovery = undefined; throw error; });
    return discovery;
  }; // Match omo-trainer's public client contract and retry discovery after provider outages.
  return {
    async begin() {
      const provider = await configured();
      const values = { verifier: oidc.randomPKCECodeVerifier(), state: oidc.randomState(), nonce: oidc.randomNonce() };
      const parameters = { redirect_uri: config.callback, ...(combined ? {prompt: "consent"} : {}), scope: combined ? "openid profile wallet:read wallet:write stars:read stars:write" : "openid profile",
        code_challenge: await oidc.calculatePKCECodeChallenge(values.verifier), code_challenge_method: "S256",
        state: values.state, nonce: values.nonce };
      const url = await authStep("authorization", () => oidc.buildAuthorizationUrl(provider, parameters));
      return { values, url: url.href };
    }, // Reuse the user's existing LiD0llID browser session through normal SSO.
    async finish(url, attempt) {
      const provider = await configured();
      const tokens = await authStep("token", () => oidc.authorizationCodeGrant(provider, url, { pkceCodeVerifier: attempt.verifier,
        expectedState: attempt.state, expectedNonce: attempt.nonce, idTokenExpected: true }));
      const claims = tokens.claims();
      if (!claims?.sub || !claims.iss) throw new Error("Missing verified identity.");
      const profile = await authStep("userinfo", () => oidc.fetchUserInfo(provider, tokens.access_token, claims.sub));
      return { issuer: claims.iss, subject: claims.sub,
        username: String(profile.preferred_username || "LiD0llID member").slice(0, 100),
        ...(combined ? {walletAccessToken: tokens.access_token} : {}) };
    }, // Verify token signature, issuer, audience, nonce, state, PKCE and UserInfo subject; retain a short-lived access token only for the explicitly approved wallet exchange.
  };
}
