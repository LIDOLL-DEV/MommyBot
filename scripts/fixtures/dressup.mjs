import { randomUUID } from "node:crypto";
import { IdentityStore } from "../../src/auth/store.js";
import { WalletService } from "../../src/wallet/service.js";
import { WalletError } from "../../src/wallet/client.js";
import { DiaperStore } from "../../src/gacha/store.js";
import { loadDiaperCatalog } from "../../src/gacha/catalog.js";
import { GachaSessions } from "../../src/gacha/sessions.js";
import { loadDressupCatalog } from "../../src/dressup/catalog.js";
import { LittlepottchiStore } from "../../src/dressup/store.js";
import { createDressupWeb } from "../../src/dressup/web.js";

export function dressupFixture() {
  const f = { coins: 1000, now: 1000000, lose: false, receipts: new Map(), catalog: loadDressupCatalog() };
  f.identities = new IdentityStore(":memory:");
  f.identity = { issuer: "https://auth.example", subject: "dressup-fixture", username: "Doll" };
  f.user = f.identities.gameAccount(f.identity).player_id;
  f.wallet = new WalletService(":memory:", { config: { baseUrl: "https://fixture.invalid/", clientId: "test" },
    balance: async () => ({ accountId: f.user, coins: f.coins, stars: 10 }),
    operation: async (_token, body) => {
      if (f.receipts.has(body.request_id)) return f.receipts.get(body.request_id);
      f.coins += body.kind === "credit" ? body.amount : -body.amount;
      const receipt = { ...body, currency: "LiDollCoin", balance: f.coins }; f.receipts.set(body.request_id, receipt);
      if (f.lose) throw new WalletError("unavailable", "Response lost.");
      return receipt;
    } });
  f.wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(f.user, "fixture", Date.now() + 3600000, f.user, "https://fixture.invalid/", "test");
  f.diapers = new DiaperStore(":memory:", loadDiaperCatalog(), f.wallet, { price: 3, enabled: true }, () => 0);
  f.clothes = new DiaperStore(":memory:", f.catalog.clothes, f.wallet, { price: 3, enabled: true, walletKey: "clothes" }, () => 0);
  f.doll = new LittlepottchiStore(f.clothes, f.diapers, f.catalog, () => f.now);
  f.sessions = new GachaSessions(f.diapers.db, f.identities);
  f.token = f.sessions.openForIdentity(f.identity);
  f.seed = (store, id, owner = f.user) => store.db.prepare("INSERT INTO diaper_items VALUES (?,?,?,NULL,?)").run(randomUUID(), id, owner, Date.now());
  f.config = { origin: "http://127.0.0.1" };
  f.web = createDressupWeb(f.config, f.clothes, f.doll, f.sessions, f.catalog);
  f.close = async () => { await f.wallet.close(); f.clothes.close(); f.diapers.close(); f.identities.close(); };
  return f;
} // Deterministic, in-memory fixtures never connect to a real identity provider or wallet.
