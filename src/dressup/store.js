import { GachaError } from "../gacha/store.js";
import { slots } from "./catalog.js";

const clamp = value => Math.max(0, Math.min(100, value));
const careRules = { feed: { hunger: 30, energy: 5 }, play: { joy: 25, energy: -10, hunger: -5 }, rest: { energy: 35 }, change: { comfort: 40 } };

export class LittlepottchiStore {
  constructor(clothes, diapers, catalog, now = Date.now) {
    this.clothes = clothes; this.diapers = diapers; this.catalog = catalog; this.db = clothes.db; this.now = now;
    this.db.exec("CREATE TABLE IF NOT EXISTS littlepottchi_players(user_id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    this.starterTop = catalog.clothes.find(item => /TShirt_1A/.test(item.image));
    if (!this.starterTop || !catalog.diapers.some(item => item.id === "cloud-tapes")) throw new Error("Missing starter outfit.");
  } // Persist care and outfits in the clothing journal; Atelier ownership remains in its original journal.

  player(user) {
    const saved = this.db.prepare("SELECT data FROM littlepottchi_players WHERE user_id=?").get(user);
    const value = saved ? JSON.parse(saved.data) : { name: "Littlepottchi", shape: "soft", hair: this.catalog.hair[0], face: this.catalog.faces.find(n => /CheekyFemale/.test(n)),
      outfit: {}, hunger: 85, energy: 85, comfort: 100, joy: 85, careCount: 0, updated: this.now(), cooldowns: {} };
    if (!saved) this.save(user, value); // Remember the first visit so offline care does not reset before the first action.
    const hours = Math.max(0, this.now() - value.updated) / 3600000;
    for (const [stat, rate] of Object.entries({ hunger: 4, energy: 2, comfort: 3, joy: 2 })) value[stat] = clamp(value[stat] - hours * rate);
    value.updated = this.now();
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
    const diaper = outfit.diaper || (outfit.underwear ? null : this.catalog.diapers.find(item => item.id === "cloud-tapes"));
    const stance = diaper?.stance || "narrow"; // Ordinary underwear uses the regular base; equipped diapers remain the stance authority.
    for (const slot of slots.filter(s => s !== "diaper")) {
      if (outfit[slot] && !outfit[slot].stances.includes(stance)) { removed.push(outfit[slot].id); delete outfit[slot]; }
    }
    return { outfit, removed, stance, base: this.catalog.bases[player.shape][stance], diaper, top: outfit.top || (outfit.bra || outfit.corset ? null : this.starterTop) };
  } // Recheck live ownership on every read so selling the last copy immediately restores the starter piece.

  snapshot(user) {
    const player = this.player(user), resolved = this.resolve(user, player);
    return { player, ...resolved, now: this.now(), careRules, ownedClothes: this.clothes.snapshot(user).owned, ownedDiapers: this.diapers.snapshot(user).owned };
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
          if (slot === "underwear" && !item.stances.includes("narrow")) throw new GachaError("Ordinary underwear needs a regular-stance fit.");
          if (!["diaper", "underwear"].includes(slot) && !item.stances.includes(this.resolve(user, player).stance)) throw new GachaError("This piece needs a different leg stance. Choose a compatible diaper first.");
          if (slot === "diaper") delete player.outfit.underwear;
          if (slot === "underwear") delete player.outfit.diaper; // The two inner-bottom choices replace each other without consuming either collectible.
          player.outfit[slot] = item.id;
        }
      } else if (Object.hasOwn(careRules, input.action)) {
        if ((player.cooldowns[input.action] || 0) > this.now()) throw new GachaError("Your doll is still enjoying that care. Try again in a moment.");
        for (const [stat, amount] of Object.entries(careRules[input.action])) player[stat] = clamp(player[stat] + amount);
        player.cooldowns[input.action] = this.now() + 30000;
        player.careCount += 1;
      } else throw new GachaError("Unknown doll action.");
      const resolved = this.resolve(user, player);
      for (const slot of slots) if (!resolved.outfit[slot]) delete player.outfit[slot];
      this.save(user, player);
      return { ...this.snapshot(user), removed: resolved.removed };
    }).immediate();
  } // Validate actions and save atomically; browser input never grants clothing or wallet currency.
}
