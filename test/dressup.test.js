import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dressupFixture } from "../scripts/fixtures/dressup.mjs";
import { dressupRoot } from "../src/dressup/catalog.js";

function fixture(t) { const f = dressupFixture(); t.after(() => f.close()); return f; }
const equip = (f, slot, design) => f.doll.act(f.user, { action: "equip", slot, design });

test("all Atelier designs map to packaged art; native layers retain 387x875 registration", t => {
  const f = fixture(t);
  assert.deepEqual(f.catalog.diapers.map(d => d.id).sort(), f.diapers.catalog.map(d => d.id).sort());
  for (const item of [...f.catalog.clothes, ...f.catalog.diapers]) {
    const bytes = readFileSync(new URL(item.image, dressupRoot));
    if (!item.rect) assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [387, 875], item.image);
    assert.equal(item.bounds.length, 4);
    for (const part of [...(item.parts || []), ...(item.backParts || [])]) {
      const bytes = readFileSync(new URL(part, dressupRoot));
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [387, 875]);
    }
  }
  for (const hair of f.catalog.hair.filter(n => /TQ_Hair_4_/.test(n))) for (const side of ["Back", "Front"]) {
    assert.ok(f.catalog.provenance[hair.replace(".png", `_${side}.png`)]);
  }
});

test("the expanded catalog includes every wearable category and preserves opaque color variants", t => {
  const f = fixture(t);
  assert.ok(f.catalog.clothes.length >= 900, "Keep the full clothing collection after excluding ordinary underwear");
  assert.ok(!f.catalog.clothes.some(item => item.slot === "underwear"));
  for (const slot of ["top", "bottom", "head", "shoes", "socks", "bra", "corset", "gloves", "belt", "accessory", "bag", "hand"]) {
    assert.ok(f.catalog.clothes.some(item => item.slot === slot), slot);
  }
  assert.ok(f.catalog.clothes.some(item => item.image === "TQ_Clothing_Bodysuit_2d.png"));
  assert.ok(!f.catalog.clothes.some(item => item.image === "TQ_Clothing_TShirt_1Ad.png"));
  const variant = f.catalog.clothes.find(item => item.id === "tq-clothing-bridaldress-2bc");
  assert.equal(variant.image, "TQ_Clothing_BridalDress_2aA.png");
  assert.deepEqual(variant.parts, ["TQ_Clothing_BridalDress_2aB.png", "TQ_Clothing_BridalDress_2bC.png"]);
  const back = f.catalog.clothes.find(item => item.id === "tq-clothing-cheerleader-2a");
  assert.equal(back.backParts.length, 2);
});

test("clothing slots persist independently; ordinary underwear is blocked and training pants remain wearable", t => {
  const f = fixture(t);
  for (const slot of ["gloves", "bag", "accessory", "bra", "corset", "belt", "hand"]) {
    const item = f.catalog.clothes.find(i => i.slot === slot && i.stances.includes("narrow"));
    f.seed(f.clothes, item.id); assert.equal(equip(f, slot, item.id).outfit[slot].id, item.id);
  }
  assert.equal(f.doll.snapshot(f.user).top, null, "Bras and corsets can be worn without a fallback shirt covering them");
  const training = f.catalog.diapers.find(i => /TrainingPants/.test(i.image));
  f.seed(f.diapers, training.id); f.seed(f.diapers, "ribbon-bouquet");
  equip(f, "diaper", "ribbon-bouquet");
  assert.throws(() => equip(f, "underwear", "old-briefs"), /Unknown clothing slot/);
  const regular = equip(f, "diaper", training.id);
  assert.equal(regular.stance, "narrow"); assert.equal(regular.diaper.id, training.id);
  const wide = equip(f, "diaper", "ribbon-bouquet");
  assert.equal(wide.stance, "wide"); assert.equal(wide.outfit.underwear, undefined);
  assert.equal(f.diapers.snapshot(f.user).owned.find(i => i.design === training.id).quantity, 1);
});

test("legacy underwear disappears from outfits, shop and bank without deleting ownership or cleaning the doll", async t => {
  const f = fixture(t), retired = {id:"old-briefs",name:"Old briefs",slot:"underwear",rarity:"common",image:"old.png"};
  f.clothes.db.prepare("INSERT INTO diaper_designs VALUES (?,?)").run(retired.id, JSON.stringify(retired));
  f.seed(f.clothes, retired.id); f.seed(f.clothes, retired.id, null);
  const p = f.doll.player(f.user); p.outfit.underwear = retired.id; p.care.wetness = 1; f.doll.save(f.user,p);
  const d = f.doll.snapshot(f.user);
  assert.equal(d.diaper.id,"cloud-tapes"); assert.equal(d.player.outfit.underwear,undefined); assert.equal(d.player.care.wetness,1);
  const shop = f.clothes.snapshot(f.user);
  assert.ok(!shop.catalog.some(i => i.id === retired.id)); assert.ok(!shop.owned.some(i => i.design === retired.id));
  assert.ok(!shop.bank.some(i => i.design === retired.id));
  await assert.rejects(f.clothes.act(f.user,"buy",retired.id,randomUUID()),/not available/);
  assert.equal(f.clothes.db.prepare("SELECT COUNT(*) n FROM diaper_items WHERE design=?").get(retired.id).n,2);
  assert.equal(f.receipts.size,0);
});

test("complete dresses include their waist and skirt sections as one rolled garment", t => {
  const f = fixture(t), dress = f.catalog.clothes.find(item => item.image === "NEWTQ_Clothing_FrillyDress_1A.png");
  assert.deepEqual(dress.parts, ["NEWTQ_Clothing_FrillyDress_1B.png", "NEWTQ_Clothing_FrillyDress_1C.png"]);
  assert.ok(dress.bounds[3] > 450);
  f.seed(f.clothes, dress.id);
  assert.deepEqual(equip(f, "top", dress.id).top.parts, dress.parts);
});

test("equipped diaper automatically selects wide and narrow bases for both body shapes", t => {
  const f = fixture(t);
  f.seed(f.diapers, "ribbon-bouquet"); f.seed(f.diapers, "cloud-tapes");
  assert.equal(equip(f, "diaper", "ribbon-bouquet").base, "DQ_Base_2.png");
  const p = f.doll.player(f.user);
  assert.equal(f.doll.act(f.user, { action: "appearance", ...p, shape: "angular" }).base, "DQ_Base_4.png");
  assert.equal(equip(f, "diaper", "cloud-tapes").base, "TQ_Base_2.png");
  assert.equal(equip(f, "diaper", null).stance, "narrow");
  assert.equal(f.doll.snapshot("someone-else").stance, "narrow");
});

test("unowned and wrong-slot items are rejected; wide diapers return incompatible clothes to the wardrobe", t => {
  const f = fixture(t), shoes = f.catalog.clothes.find(i => i.slot === "shoes" && i.stances.includes("narrow"));
  assert.throws(() => equip(f, "shoes", shoes.id), /available copy/);
  f.seed(f.clothes, shoes.id); f.seed(f.diapers, "ribbon-bouquet");
  assert.throws(() => equip(f, "head", shoes.id), /available copy/);
  equip(f, "shoes", shoes.id);
  const changed = equip(f, "diaper", "ribbon-bouquet");
  assert.deepEqual(changed.removed, [shoes.id]); assert.equal(changed.outfit.shoes, undefined);
  assert.throws(() => equip(f, "shoes", shoes.id), /different leg stance/);
  assert.equal(f.clothes.snapshot(f.user).owned[0].quantity, 1);
});

test("sales and reservations revoke wearable entitlement only when no available copy remains", async t => {
  const f = fixture(t); f.seed(f.diapers, "ribbon-bouquet"); f.seed(f.diapers, "ribbon-bouquet");
  equip(f, "diaper", "ribbon-bouquet");
  await f.diapers.act(f.user, "sell", "ribbon-bouquet", randomUUID());
  assert.equal(f.doll.snapshot(f.user).stance, "wide");
  f.lose = true;
  await assert.rejects(f.diapers.act(f.user, "sell", "ribbon-bouquet", randomUUID()), /Response lost/);
  assert.equal(f.doll.snapshot(f.user).stance, "narrow");
  await f.diapers.retry(f.user);
  assert.equal(f.doll.snapshot(f.user).diaper.id, "cloud-tapes");
});

test("clothing and diaper journals share wallet guards and recover one charged prize", async t => {
  const f = fixture(t), request = randomUUID(); f.lose = true;
  await assert.rejects(f.clothes.act(f.user, "roll", null, request, 3), /Response lost/);
  assert.equal(f.wallet.clothes, f.clothes); assert.equal(f.wallet.gacha, f.diapers);
  await assert.rejects(f.diapers.act(f.user, "roll", null, randomUUID(), 3), /pending payment first/);
  await f.clothes.retry(f.user);
  await f.clothes.act(f.user, "roll", null, request, 3);
  assert.equal(f.receipts.size, 1); assert.equal(f.coins, 997);
  assert.equal(f.clothes.snapshot(f.user).owned[0].quantity, 1);
  assert.equal(f.diapers.snapshot(f.user).owned.length, 0);
});

test("care uses bounded server time, cooldowns, and persists without consuming items or coins", t => {
  const f = fixture(t); f.now += 3600000;
  f.doll.act(f.user, { action: "feed" });
  assert.throws(() => f.doll.act(f.user, { action: "feed" }), /still enjoying/);
  f.now += 1000 * 3600 * 1000;
  const elapsed = f.doll.snapshot(f.user);
  assert.equal(elapsed.player.hunger, 0); assert.equal(elapsed.player.comfort, 0);
  assert.throws(() => f.doll.act(f.user, { action: "change" }), /replacement diaper/);
  const changed = f.doll.act(f.user, { action: "change", design: "cloud-tapes" });
  assert.equal(changed.player.comfort, 100); assert.equal(changed.player.careCount, 2);
  assert.equal(f.coins, 1000); assert.equal(f.receipts.size, 0);
  assert.throws(() => f.doll.act(f.user, { action: "appearance", ...changed.player, hair: "../../unknown" }), /character builder/);
});

test("wardrobe HTTP routes require the shared session and CSRF, and serve only packaged artwork", async t => {
  const f = fixture(t), server = createServer(async (req, res) => { if (!await f.web(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  f.config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, options = {}) => fetch(f.config.origin + path, options);
  assert.equal((await request("/clothes/api/state")).status, 401);
  const headers = { Cookie: `diaper_session=${f.token}`, Origin: f.config.origin, "Content-Type": "application/json" };
  const state = await (await request("/littlepottchi/api/state", { headers })).json();
  assert.equal(state.catalog.provenance, undefined);
  assert.equal((await request("/littlepottchi/api/doll", { method: "POST", headers, body: '{"action":"feed"}' })).status, 403);
  headers["X-CSRF-Token"] = state.csrf;
  assert.equal((await request("/littlepottchi/api/doll", { method: "POST", headers, body: '{"action":"feed"}' })).status, 200);
  assert.equal((await request("/clothes/art/TQ_Base_3.png")).status, 200);
  assert.equal((await request("/clothes/art/missing.png")).status, 404);
  assert.equal((await request("/clothes/art/TQ_Clothing_Knickers_Briefs_1.png")).status, 404);
  assert.equal((await request("/clothes/api/action", { method: "POST", headers, body: JSON.stringify({ action: "roll", request: randomUUID(), amount: 1 }) })).status, 400);
  assert.equal(f.receipts.size, 0);
  f.sessions.revoke(f.user);
  assert.equal((await request("/clothes/api/state", { headers })).status, 401);
});
