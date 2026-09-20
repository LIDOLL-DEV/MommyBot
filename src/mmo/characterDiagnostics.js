import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { characterConfig } from "./character.js";
import { OnlineError } from "./feed.js";

const mask = value => {
  const text = String(value ?? "");
  return text.length <= 10 ? `${text.slice(0, 2)}…` : `${text.slice(0, 6)}…${text.slice(-4)} (${text.length} chars)`;
}; // Enough of an account ID to compare two servers by eye, never enough to reuse.

function walletAccount(discordId, filename = "data/wallet.db") {
  if (!/^\d{17,20}$/.test(String(discordId || ""))) throw new OnlineError("bad_discord_id", "Pass the member's 17-20 digit Discord user ID.");
  if (!existsSync(filename)) throw new OnlineError("wallet_db_missing", `No wallet database at ${filename}. Run this as the bot account from the release directory.`);
  const db = new Database(filename, { readonly: true });
  try {
    const row = db.prepare("SELECT account_id,base_url,client_id,expires FROM online_wallets WHERE discord_id=?").get(String(discordId));
    if (!row) throw new OnlineError("not_connected", "That Discord user has no connected wallet. They need /lidollid login before /lidollmmo can identify them.");
    return row;
  } finally { db.close(); }
} // Read only the linkage /lidollmmo itself uses, from a read-only handle, and never the stored bearer token.

export async function inspectCharacter(env = process.env, discordId, { fetcher = fetch, filename } = {}) {
  const result = { ok: false, checks: [] };
  const add = (name, ok, detail) => { result.checks.push({ name, ok, detail }); return ok; };
  let config;
  try { config = characterConfig(env); }
  catch (error) { add("configuration", false, error.message); return result; }
  if (!config) {
    add("configuration", false, "/lidollmmo is off. Set LIDOLLMMO_CHARACTERS_ENABLED=true and LIDOLLMMO_ONLINE_URL, and restart MommyBot.");
    return result;
  }
  add("configuration", true, `Character endpoint: ${config.url}`);
  if (!/\/integrations\/mommybot\/character$/.test(new URL(config.url).pathname)) {
    add("endpoint path", false, "The derived URL does not end in /integrations/mommybot/character. LIDOLLMMO_ONLINE_URL must end in /joins, or set LIDOLLMMO_CHARACTER_URL explicitly.");
    return result;
  }
  add("endpoint path", true, "Derived from the join feed URL.");

  let account;
  try { account = walletAccount(discordId, filename ?? env.LIDOLLCOIN_DB ?? "data/wallet.db"); }
  catch (error) { add("wallet link", false, error.message); return result; }
  add("wallet link", true, `MommyBot will ask LiDollQuest for account_id ${mask(account.account_id)}. It must match quest_characters.owner on the game server.`);
  if (account.base_url !== env.LIDOLLCOIN_API_URL && env.LIDOLLCOIN_API_URL) {
    add("wallet origin", false, `That connection was made against ${account.base_url}, but LIDOLLCOIN_API_URL is now ${env.LIDOLLCOIN_API_URL}. A wallet reconnected against a different tracker yields a different account_id. Have them run /lidollid login again.`);
  } else add("wallet origin", true, `Connection made against ${account.base_url}.`);

  const url = new URL(config.url);
  url.searchParams.set("account_id", account.account_id);
  let response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(10000) });
  } catch {
    add("game server", false, "Could not reach the game server. Check LIDOLLMMO_ONLINE_URL, the port, the firewall and that LiDollQuest is running.");
    return result;
  }
  let body = null;
  try { body = JSON.parse(await response.text()); } catch { /* A proxy error page is not JSON; the status still classifies it. */ }
  if (response.status === 404 && body?.error === "character_unavailable") {
    add("character", false, `The game server has no character owned by account_id ${mask(account.account_id)}, or that account is suspended. This is the usual cause: the LiD0llID used for /lidollid login is not the one the character was made under. Compare this masked ID against quest_characters.owner on the game server.`);
    return result;
  }
  if (response.status === 404) {
    add("game server", false, "The game server returned 404 without the expected error body, so it is not running a build with /integrations/mommybot/character. Deploy the updated LiDollQuest server.");
    return result;
  }
  if (response.status === 401) {
    add("game server", false, "The game server rejected the credential. Set the same MOMMYBOT_ONLINE_TOKEN on both services and restart both.");
    return result;
  }
  if (response.status === 503) {
    add("game server", false, "Character sharing is disabled on the game server because MOMMYBOT_ONLINE_TOKEN is unset there.");
    return result;
  }
  if (!response.ok) {
    add("game server", false, `The game server returned HTTP ${response.status}. Check its logs and any reverse proxy.`);
    return result;
  }
  if (!body || typeof body !== "object") {
    add("game server", false, "The endpoint answered with something other than a character sheet. A proxy may be intercepting the path.");
    return result;
  }
  add("game server", true, `Answered with character ${JSON.stringify(String(body.name ?? "")).slice(0, 40)} (${body.characters?.length ?? 0} on the account).`);
  result.ok = true;
  return result;
} // Report exactly which stage fails, naming only fields and masked identifiers, never the bridge token or a full account ID.
