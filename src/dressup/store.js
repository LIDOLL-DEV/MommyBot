import { GachaError } from "../gacha/store.js";
import { slots } from "./catalog.js";
import { PetCare, careRules, messyRules } from "./care.js";

export class LittlepottchiStore {
  constructor(clothes, diapers, catalog, now = Date.now) {
    this.clothes = clothes; this.diapers = diapers; this.catalog = catalog; this.db = clothes.db; this.now = now;
    this.db.exec("CREATE TABLE IF NOT EXISTS littlepottchi_players(user_id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    this.care = new PetCare(this.db, catalog, now);
    this.starterTop = catalog.clothes.find(item => /TShirt_1A/.test(item.image));
    if (!this.starterTop || !catalog.diapers.some(item => item.id === "cloud-tapes")) throw new Error("Missing starter outfit.");
  } // Persist care and outfits in the clothing journal; Atelier ownership remains in its original journal.

  player(user) {
    const saved = this.db.prepare("SELECT data FROM littlepottchi_players WHERE user_id=?").get(user);
    const value = saved ? JSON.parse(saved.data) : { name: "Littlepottchi", shape: "soft", hair: this.catalog.hair[0], face: this.catalog.faces.find(n => /CheekyFemale/.test(n)),
      outfit: {}, hunger: 85, energy: 85, comfort: 100, joy: 85, careCount: 0, updated: this.now(), cooldowns: {} };
    const resolved = this.resolve(user, value);
    delete value.outfit.underwear;
    this.care.advance(value, resolved.diaper); // Migrate retired underwear to the starter diaper without cleaning existing wetness.
    this.save(user, value); this.care.record(user, value);
    return value;
  } // Apply bounded offline care decay from server time, with no death or loss of collectibles.

  save(user, player) { this.db.prepare("INSERT INTO littlepottchi_players VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data").run(user, JSON.stringify(player)); }

  owned(user, slot, id) {
    const store = slot === "diaper" ? this.diapers : this.clothes;
    return Boolean(store.db.prepare("SELECT 1 FROM diaper_items WHERE owner=? AND design=? AND lock_id IS NULL LIMIT 1").get(user, id));
  } // Reserved sale copies cannot be worn; another available copy preserves the design entitlement.

  resolve(user, player) {
    const outfit = {}, removed = [];
    for (const slot of slots) {
      const id = player.outfit[slot];
      const item = (slot === "diaper" ? this.catalog.diapers : this.catalog.clothes).find(item => item.id === id && (slot === "diaper" || item.slot === slot));
      if (item && this.owned(user, slot, id)) outfit[slot] = item;
      else if (id) removed.push(id);
    }
    if (player.outfit.underwear) removed.push(player.outfit.underwear);
    const diaper = outfit.diaper || this.catalog.diapers.find(item => item.id === "cloud-tapes");
    const stance = diaper.stance; // Diapers and training pants are the only inner-bottom choices, including for legacy saves.
    for (const slot of slots.filter(s => s !== "diaper")) {
      if (outfit[slot] && !outfit[slot].stances.includes(stance)) { removed.push(outfit[slot].id); delete outfit[slot]; }
    }
    return { outfit, removed, stance, base: this.catalog.bases[player.shape][stance], diaper, top: outfit.top || (outfit.bra || outfit.corset ? null : this.starterTop) };
  } // Recheck live ownership on every read so selling the last copy immediately restores the starter piece.

  snapshot(user) {
    const player = this.player(user), resolved = this.resolve(user, player);
    return { player, ...resolved, now: this.now(), careRules, messyRules, usedBulk: player.care.wetness + player.care.mess * messyRules.bulkPerAccident, rhythm: this.care.profile(),
      ownedClothes: this.clothes.snapshot(user).owned, ownedDiapers: this.diapers.snapshot(user).owned };
  }

  act(user, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new GachaError("Invalid doll action.");
    return this.db.transaction(() => {
      const player = this.player(user);
      if (input.action === "appearance") {
        if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 32 || /[\x00-\x1f]/.test(input.name) ||
            !["soft", "angular"].includes(input.shape) || !this.catalog.hair.includes(input.hair) || !this.catalog.faces.includes(input.face)) throw new GachaError("Choose a name, body, hair and face from the character builder.");
        Object.assign(player, { name: input.name.trim(), shape: input.shape, hair: input.hair, face: input.face });
      } else if (input.action === "equip") {
        const slot = input.slot;
        if (!slots.includes(slot)) throw new GachaError("Unknown clothing slot.");
        if (input.design === null) delete player.outfit[slot];
        else {
          const item = (slot === "diaper" ? this.catalog.diapers : this.catalog.clothes).find(item => item.id === input.design && (slot === "diaper" || item.slot === slot));
          if (!item || !this.owned(user, slot, item.id)) throw new GachaError("You need an available copy in your collection to wear this item.");
          if (slot !== "diaper" && !item.stances.includes(this.resolve(user, player).stance)) throw new GachaError("This piece needs a different leg stance. Choose a compatible diaper first.");
          if (slot === "diaper") delete player.outfit.underwear;
          player.outfit[slot] = item.id;
          if (slot === "diaper") this.care.change(player);
        }
      } else if (input.action === "change") {
        const item = this.catalog.diapers.find(item => item.id === input.design);
        if (!item || (item.id !== "cloud-tapes" && !this.owned(user, "diaper", item.id))) throw new GachaError("Choose a replacement diaper from your collection or the starter supply.");
        if (item.id === "cloud-tapes" && !this.owned(user, "diaper", item.id)) delete player.outfit.diaper;
        else player.outfit.diaper = item.id;
        delete player.outfit.underwear; this.care.change(player);
      } else {
        this.care.act(player, input);
        if (input.action === "reminders") {
          const identity = this.identity?.(user);
          if (input.enabled && !identity) throw new GachaError("Sign in to link pet reminders to Little Log.");
          player.care.recipient = input.enabled ? { issuer: identity.issuer, subject: identity.subject } : null;
        }
      }
      const resolved = this.resolve(user, player);
      delete player.outfit.underwear; // Retire the old slot without resetting accumulated wetness or any care timer.
      for (const slot of slots) if (!resolved.outfit[slot]) delete player.outfit[slot];
      this.save(user, player);
      return { ...this.snapshot(user), removed: resolved.removed };
    }).immediate();
  } // Validate actions and save atomically; browser input never grants clothing or wallet currency.

  tick(limit = 100) {
    const rows = this.db.prepare("SELECT user_id FROM littlepottchi_players WHERE user_id>? ORDER BY user_id LIMIT ?").all(this.tickCursor || "", limit);
    this.db.transaction(() => { for (const row of rows) this.player(row.user_id); }).immediate();
    this.tickCursor = rows.length === limit ? rows.at(-1).user_id : "";
  } // Advance a bounded batch while browsers are closed; the cursor cycles through every saved doll.
}
