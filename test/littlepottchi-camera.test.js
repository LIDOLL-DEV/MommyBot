import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dressupFixture } from "../scripts/fixtures/dressup.mjs";
import { dressupRoot } from "../src/dressup/catalog.js";
import { HOUR } from "../src/dressup/care.js";

const fixture = t => { const f = dressupFixture(); t.after(() => f.close()); return f; };
const buy = (f,request = randomUUID()) => f.clothes.act(f.user,"wipes","baby-wipe",request,1);

test("cameras cover every diaper; wettings stay clean and messy frames require messy mode", t => {
  const f = fixture(t);
  for (const item of f.catalog.diapers) {
    assert.ok(item.buttcams[0].endsWith("_1.png"));
    for (const name of item.buttcams) assert.ok(f.catalog.provenance[name]);
    assert.ok(!item.buttcams.some(name => /Panties|Briefs|Hotpants/.test(name)));
  }
  f.seed(f.diapers,"ribbon-bouquet"); let d = f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"});
  f.now = d.player.care.nextWettingAt; d = f.doll.snapshot(f.user); assert.equal(d.buttcam.frame,0);
  d = f.doll.act(f.user,{action:"messy-mode",enabled:true}); f.now = d.player.care.nextMessAt;
  d = f.doll.snapshot(f.user); assert.equal(d.buttcam.frame,1); assert.match(d.buttcam.image,/_2.png$/);
  d = f.doll.act(f.user,{action:"messy-mode",enabled:false}); assert.equal(d.buttcam.frame,0); assert.equal(d.player.care.mess,1);
  d = f.doll.act(f.user,{action:"equip",slot:"diaper",design:null}); assert.equal(d.diaper,null);
  assert.equal(d.buttcam.image,f.catalog.bareCameras.soft); assert.equal(d.player.care.nextWettingAt > f.now,true);
});

test("diaper-free wet and messy accidents require exactly one wipe before either equip path", async t => {
  const f = fixture(t); f.seed(f.diapers,"ribbon-bouquet");
  f.doll.act(f.user,{action:"equip",slot:"diaper",design:null}); f.doll.act(f.user,{action:"messy-mode",enabled:true});
  f.now += 24 * HOUR; let d = f.doll.snapshot(f.user);
  assert.equal(d.player.care.bodyWetness,6); assert.equal(d.player.care.bodyMess,2); assert.equal(d.player.care.needsWipe,true);
  assert.equal(d.usedBulk,0); assert.equal(d.diaper,null);
  for (const input of [{action:"change",design:"cloud-tapes"},{action:"equip",slot:"diaper",design:"ribbon-bouquet"}]) assert.throws(() => f.doll.act(f.user,input),/baby wipe/);
  assert.throws(() => f.doll.act(f.user,{action:"wipe"}),/Buy a baby wipe/);
  const wetClock = d.player.care.nextWettingAt, messClock = d.player.care.nextMessAt;
  await buy(f); d = f.doll.act(f.user,{action:"wipe"});
  assert.equal(d.supplies.wipes,0); assert.equal(d.player.care.bodyWetness,0); assert.equal(d.player.care.bodyMess,0); assert.equal(d.player.care.needsWipe,false);
  assert.equal(d.player.care.nextWettingAt,wetClock); assert.equal(d.player.care.nextMessAt,messClock);
  assert.throws(() => f.doll.act(f.user,{action:"wipe"}),/does not need/);
  d = f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"}); assert.equal(d.stance,"wide"); assert.equal(d.diaper.id,"ribbon-bouquet");
  assert.equal(f.coins,999); assert.equal(f.receipts.size,1);
});

test("contained accidents change freely; leaks retain cleanup after removal and a wipe survives ordinary reads", async t => {
  const f = fixture(t); f.seed(f.diapers,"ribbon-bouquet");
  let d = f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"});
  f.now = d.player.care.nextWettingAt; d = f.doll.act(f.user,{action:"change",design:"cloud-tapes"});
  assert.equal(d.player.care.needsWipe,false); assert.equal(f.receipts.size,0);
  f.now = d.player.care.nextWettingAt + d.player.care.interval; d = f.doll.snapshot(f.user);
  assert.equal(d.player.care.leaking,true); assert.equal(d.player.care.needsWipe,true);
  await buy(f); d = f.doll.act(f.user,{action:"wipe"}); assert.equal(d.player.care.leaking,true);
  assert.equal(f.doll.snapshot(f.user).player.care.needsWipe,false);
  d = f.doll.act(f.user,{action:"change",design:"cloud-tapes"}); assert.equal(d.player.care.leaking,false);
  f.now = d.player.care.nextWettingAt + d.player.care.interval; f.doll.snapshot(f.user);
  d = f.doll.act(f.user,{action:"equip",slot:"diaper",design:null}); assert.equal(d.player.care.needsWipe,true);
  assert.throws(() => f.doll.act(f.user,{action:"change",design:"cloud-tapes"}),/baby wipe/);
});

test("wipe purchases preserve price and deliver once after lost responses and paid storage failures", async t => {
  const f = fixture(t), request = randomUUID(); f.lose = true;
  await assert.rejects(buy(f,request),/Response lost/); assert.equal(f.clothes.supplySnapshot(f.user).wipes,0);
  await assert.rejects(f.diapers.act(f.user,"roll",null,randomUUID()),/pending payment/);
  f.clothes.wipePrice = 2; await f.clothes.retry(f.user); await buy(f,request);
  assert.equal(f.coins,999); assert.equal(f.clothes.supplySnapshot(f.user).wipes,1); assert.equal(f.receipts.size,1);
  f.lose = false; f.clothes.wipePrice = 1;
  f.clothes.db.exec("CREATE TRIGGER stop_wipe_delivery BEFORE UPDATE ON care_supplies BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  await assert.rejects(buy(f),/fixture failure/); assert.equal(f.clothes.pending(f.user).state,"paid");
  assert.equal(f.clothes.supplySnapshot(f.user).wipes,1);
  f.clothes.db.exec("DROP TRIGGER stop_wipe_delivery"); await f.clothes.retry(f.user);
  assert.equal(f.coins,998); assert.equal(f.clothes.supplySnapshot(f.user).wipes,2); assert.equal(f.receipts.size,2);
  assert.ok(!f.clothes.snapshot(f.user).catalog.some(item => item.id === "baby-wipe"));
});

test("a new diaper-free accident after wiping creates a new cleanup reminder", async t => {
  const f = fixture(t); f.doll.act(f.user,{action:"reminders",enabled:true});
  f.doll.act(f.user,{action:"equip",slot:"diaper",design:null}); f.now += 4 * HOUR; f.doll.tick();
  const events = () => f.doll.care.events(user => f.identities.gameIdentity(user),user => f.doll.player(user)).events.filter(e => e.kind === "cleanup");
  const first = events()[0]; assert.ok(first); f.doll.care.ack([first.id]);
  await buy(f); f.doll.act(f.user,{action:"wipe"}); assert.equal(events().length,0);
  f.now += 4 * HOUR; f.doll.tick(); const second = events()[0]; assert.ok(second); assert.notEqual(second.id,first.id);
});

test("wipe use rolls back its inventory deduction if saving clean pet state fails", async t => {
  const f = fixture(t); f.doll.act(f.user,{action:"equip",slot:"diaper",design:null});
  f.now += 4 * HOUR; f.doll.snapshot(f.user); await buy(f);
  f.clothes.db.exec("CREATE TRIGGER stop_clean_save BEFORE UPDATE ON littlepottchi_players WHEN json_extract(NEW.data,'$.care.needsWipe')=0 BEGIN SELECT RAISE(ABORT,'clean save failed'); END");
  assert.throws(() => f.doll.act(f.user,{action:"wipe"}),/clean save failed/);
  assert.equal(f.clothes.supplySnapshot(f.user).wipes,1); assert.equal(f.doll.snapshot(f.user).player.care.needsWipe,true);
  f.clothes.db.exec("DROP TRIGGER stop_clean_save"); f.doll.act(f.user,{action:"wipe"}); assert.equal(f.clothes.supplySnapshot(f.user).wipes,0);
});

test("camera and supply HTTP routes enforce sessions, selected frames, CSRF and quoted prices", async t => {
  const f = fixture(t), server = createServer(async (req,res) => { if (!await f.web(req,res)) {res.writeHead(404);res.end();} });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve)); f.config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const headers = {Cookie:`diaper_session=${f.token}`,Origin:f.config.origin,"Content-Type":"application/json"};
  const request = (path,options = {}) => fetch(f.config.origin + path,{headers,...options});
  assert.equal((await fetch(f.config.origin + "/littlepottchi/api/buttcam")).status,401);
  let d = f.doll.snapshot(f.user); const clean = readFileSync(new URL(d.buttcam.image,dressupRoot));
  assert.deepEqual(Buffer.from(await (await request("/littlepottchi/api/buttcam?frame=999")).arrayBuffer()),clean);
  assert.equal((await request(`/clothes/art/${d.buttcam.image}`)).status,404);
  const p = d.player; p.care.mess = 999; f.doll.save(f.user,p);
  assert.deepEqual(Buffer.from(await (await request("/littlepottchi/api/buttcam?frame=2")).arrayBuffer()),clean);
  d = f.doll.act(f.user,{action:"messy-mode",enabled:true});
  assert.equal(d.buttcam.image,d.diaper.buttcams.at(-1));
  assert.deepEqual(Buffer.from(await (await request("/littlepottchi/api/buttcam")).arrayBuffer()),readFileSync(new URL(d.buttcam.image,dressupRoot)));
  const payload = {action:"buy",amount:1,request:randomUUID()};
  assert.equal((await request("/diapers/api/supplies",{method:"POST",body:JSON.stringify(payload)})).status,403);
  const state = await (await request("/diapers/api/state")).json(); headers["X-CSRF-Token"] = state.csrf;
  const rejected = await request("/diapers/api/supplies",{method:"POST",body:JSON.stringify({...payload,amount:2})});
  assert.equal(rejected.status,400); assert.equal((await rejected.json()).retryable,false);
  assert.equal((await request("/diapers/api/supplies",{method:"POST",body:JSON.stringify(payload)})).status,200);
  assert.equal((await request("/diapers/api/supplies",{method:"POST",body:JSON.stringify(payload)})).status,200);
  assert.equal(f.receipts.size,1); assert.equal(f.clothes.supplySnapshot(f.user).wipes,1);
  assert.equal(f.clothes.supplySnapshot("someone-else").wipes,0);
});
