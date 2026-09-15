import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dressupFixture } from "../scripts/fixtures/dressup.mjs";
import { analysisProfile, HOUR, messyRules } from "../src/dressup/care.js";
import { createDressupWeb } from "../src/dressup/web.js";
import { LittlepottchiStore } from "../src/dressup/store.js";

const fixture = t => { const f = dressupFixture(); t.after(() => f.close()); return f; };
const wipe = f => { f.clothes.db.prepare("INSERT INTO care_supplies VALUES (?,1) ON CONFLICT(user_id) DO UPDATE SET wipes=wipes+1").run(f.user); f.doll.act(f.user,{action:"wipe"}); };
const report = (finished = 1000000, rate = 6) => ({reportId:`report-${finished}`,finished,
  days:[{date:"2026-09-14",wettings:rate * 2,activeParticipants:2,randomPeeResults:999},{date:"2026-09-15",wettings:rate,activeParticipants:1}]});

test("messy mode starts off, migrates old care state safely, and preserves its countdown across toggles and restart", t => {
  const f = fixture(t); f.doll.care.importAnalysis(report(f.now,0));
  let d = f.doll.snapshot(f.user); assert.equal(d.player.care.messyMode,false); assert.equal(d.player.care.nextMessAt,null);
  const p = d.player; p.care.wetness = 1;
  for (const key of ["messyMode","mess","messings","nextMessAt","messRemaining"]) delete p.care[key];
  f.doll.save(f.user,p); f.now += 48 * HOUR; d = f.doll.snapshot(f.user);
  assert.equal(d.player.care.mess,0); assert.equal(d.player.care.wetness,1); assert.equal(d.player.care.messyMode,false);
  assert.throws(() => f.doll.act(f.user,{action:"messy-mode",enabled:"true"}),/whether to enable/);
  d = f.doll.act(f.user,{action:"messy-mode",enabled:true}); const first = d.player.care.nextMessAt;
  f.now += HOUR; d = f.doll.act(f.user,{action:"messy-mode",enabled:true}); assert.equal(d.player.care.nextMessAt,first);
  d = f.doll.act(f.user,{action:"messy-mode",enabled:false}); const remaining = first - f.now;
  f.now += 72 * HOUR; d = f.doll.snapshot(f.user); assert.equal(d.player.care.mess,0);
  d = f.doll.act(f.user,{action:"messy-mode",enabled:true}); assert.equal(d.player.care.nextMessAt,f.now + remaining);
  f.doll = new LittlepottchiStore(f.clothes,f.diapers,f.catalog,() => f.now);
  f.now = d.player.care.nextMessAt - 1; assert.equal(f.doll.snapshot(f.user).player.care.mess,0);
  f.now++; d = f.doll.snapshot(f.user); assert.equal(d.player.care.mess,1); assert.equal(d.player.care.messings,1);
  assert.equal(f.doll.snapshot(f.user).player.care.mess,1);
});

test("messy intervals include 10 and 14 hours, vary per accident and persist across offline catch-up and restart", t => {
  const f = fixture(t), delays = [10, 14, 11, 13]; let draws = 0;
  f.doll.care.random = (min, max) => {
    assert.equal(min, 10 * HOUR); assert.equal(max, 14 * HOUR + 1);
    assert.ok(draws < delays.length, "Existing countdowns must not be rerolled.");
    return delays[draws++] * HOUR;
  };
  f.doll.care.importAnalysis(report(f.now,0)); f.seed(f.diapers,"ribbon-bouquet");
  f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"});
  let d = f.doll.act(f.user,{action:"messy-mode",enabled:true});
  const first = f.now + 10 * HOUR;
  assert.equal(d.player.care.nextMessAt,first);
  f.now = first - 1; assert.equal(f.doll.snapshot(f.user).player.care.mess,0); assert.equal(draws,1);
  f.now++; d = f.doll.snapshot(f.user);
  assert.equal(d.player.care.mess,1); assert.equal(d.player.care.nextMessAt,first + 14 * HOUR);
  f.now = first + 25 * HOUR; d = f.doll.snapshot(f.user);
  assert.equal(d.player.care.mess,3); assert.equal(d.player.care.nextMessAt,f.now + 13 * HOUR); assert.equal(draws,4);
  const deadline = d.player.care.nextMessAt;
  assert.equal(f.doll.snapshot(f.user).player.care.mess,3); assert.equal(draws,4);
  f.doll = new LittlepottchiStore(f.clothes,f.diapers,f.catalog,() => f.now);
  f.doll.care.random = () => { throw Error("An existing countdown must survive restart and changes."); };
  assert.equal(f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"}).player.care.nextMessAt,deadline);
  f.doll.act(f.user,{action:"messy-mode",enabled:false}); f.now += 100 * HOUR;
  d = f.doll.act(f.user,{action:"messy-mode",enabled:true});
  assert.equal(d.player.care.nextMessAt,f.now + 13 * HOUR); assert.equal(d.player.care.messings,3);
});

test("wet and messy accidents share bulk; fresh replacement clears both and preserves both clocks", t => {
  const f = fixture(t); f.doll.care.importAnalysis(report(f.now,0)); f.seed(f.diapers,"ribbon-bouquet");
  let d = f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"});
  d = f.doll.act(f.user,{action:"messy-mode",enabled:true});
  const p = d.player; p.care.wetness = d.diaper.bulk - messyRules.bulkPerAccident; f.doll.save(f.user,p);
  f.now = p.care.nextMessAt; d = f.doll.snapshot(f.user);
  assert.equal(d.player.care.mess,1); assert.equal(d.usedBulk,d.diaper.bulk); assert.equal(d.player.care.leaking,false);
  assert.equal(d.player.care.uncomfortable,true); assert.ok(d.player.comfort <= 35);
  d = f.doll.act(f.user,{action:"messy-mode",enabled:false}); assert.equal(d.player.care.leaking,false); assert.equal(d.player.care.mess,1);
  d = f.doll.act(f.user,{action:"messy-mode",enabled:true}); const nextMess = d.player.care.nextMessAt, nextWet = d.player.care.nextWettingAt;
  d = f.doll.act(f.user,{action:"change",design:"cloud-tapes"});
  assert.equal(d.usedBulk,0); assert.equal(d.player.care.mess,0); assert.equal(d.player.care.leaking,false);
  assert.equal(d.player.care.nextMessAt,nextMess); assert.equal(d.player.care.nextWettingAt,nextWet);
  assert.equal(d.player.care.messings,1); assert.equal(d.stance,"narrow");
  assert.equal(f.coins,1000); assert.equal(f.diapers.snapshot(f.user).owned[0].quantity,1);
});

test("offline messy accidents catch up once and current messy reminders are cancelled by a fresh change", t => {
  const f = fixture(t); f.doll.care.importAnalysis(report(f.now,0)); f.seed(f.diapers,"ribbon-bouquet");
  f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"});
  f.doll.act(f.user,{action:"reminders",enabled:true});
  const started = f.doll.act(f.user,{action:"messy-mode",enabled:true});
  f.now = started.player.care.nextMessAt + 12 * HOUR; f.doll.tick();
  let d = f.doll.snapshot(f.user); assert.equal(d.player.care.mess,2); assert.equal(d.usedBulk,2); assert.equal(d.player.care.leaking,false);
  const events = () => f.doll.care.events(user => f.identities.gameIdentity(user),user => f.doll.player(user)).events;
  const first = events().filter(e => e.kind === "mess"); assert.equal(first.length,1);
  f.doll.tick(); assert.equal(events().filter(e => e.kind === "mess")[0].id,first[0].id);
  f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"}); assert.equal(events().some(e => e.kind === "mess"),false);
  f.now += 1000 * 12 * HOUR; d = f.doll.snapshot(f.user); assert.equal(d.player.care.mess,1000);
  assert.equal(d.player.care.leaking,true); assert.equal(f.doll.snapshot(f.user).player.care.mess,1000);
  assert.equal(events().filter(e => e.kind === "cleanup").length,1); assert.equal(events().some(e => e.kind === "mess"),false);
});

test("community rate uses saved wettings per active participant-day, with explicit zero and bounds", () => {
  const profile = analysisProfile(report(), 1000000);
  assert.equal(profile.rate, 6); assert.equal(profile.interval, 4 * HOUR); assert.equal(profile.participantDays, 3);
  assert.equal(analysisProfile(report(1,0), 1).interval, null);
  assert.equal(analysisProfile(report(1,100), 1).interval, HOUR / 2);
  for (const bad of [{...report(),days:[]},{...report(),days:[{date:"2026-09-15",wettings:1,activeParticipants:0}]},
    {...report(),days:[{date:"2026-09-15",wettings:-1,activeParticipants:1}]}, {...report(),days:[...report().days,report().days[0]]}]) {
    assert.throws(() => analysisProfile(bad,1000000));
  }
});

test("wettings persist across reads and restarts; full diapers are uncomfortable and actual leaks need cleanup", t => {
  const f = fixture(t); f.doll.care.importAnalysis(report());
  let d = f.doll.snapshot(f.user); const interval = d.player.care.interval, bulk = d.diaper.bulk, first = d.player.care.nextWettingAt;
  f.now = first; d = f.doll.snapshot(f.user); assert.equal(d.player.care.wetness,1);
  assert.equal(f.doll.snapshot(f.user).player.care.wetness,1);
  f.doll = new LittlepottchiStore(f.clothes,f.diapers,f.catalog,() => f.now);
  f.now += (bulk - 1) * interval; d = f.doll.snapshot(f.user);
  assert.equal(d.player.care.wetness,bulk); assert.equal(d.player.care.leaking,false); assert.equal(d.player.care.uncomfortable,true);
  f.doll.care.leakRandom = () => 0;
  f.now += interval; d = f.doll.snapshot(f.user); assert.equal(d.player.care.leaking,true);
  d = f.doll.act(f.user,{...d.player,action:"appearance",name:"Still wet"}); assert.equal(d.player.care.leaking,true);
  const next = d.player.care.nextWettingAt;
  d = f.doll.act(f.user,{action:"equip",slot:"diaper",design:null}); assert.equal(d.player.care.needsWipe,true); assert.equal(d.diaper,null);
  assert.throws(() => f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"}),/replacement/);
  f.seed(f.diapers,"ribbon-bouquet"); wipe(f); d = f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"});
  assert.equal(d.stance,"wide"); assert.equal(d.player.care.wetness,0); assert.equal(d.player.care.leaking,false);
  assert.equal(d.player.care.nextWettingAt,next); assert.equal(f.diapers.snapshot(f.user).owned[0].quantity,1);
  f.now = next; d = f.doll.snapshot(f.user); assert.equal(d.player.care.wetness,1);
  d = f.doll.act(f.user,{action:"equip",slot:"diaper",design:"ribbon-bouquet"}); assert.equal(d.player.care.wetness,0);
  assert.equal(f.coins,1000);
});

test("new reports alter future rhythm, stale reports cannot roll it back, and zero pauses wettings", t => {
  const f = fixture(t); f.doll.care.importAnalysis(report()); const start = f.doll.snapshot(f.user);
  f.now += HOUR; f.doll.care.importAnalysis(report(f.now,12));
  let d = f.doll.snapshot(f.user); assert.equal(d.player.care.wetness,0);
  assert.equal(d.player.care.nextWettingAt, f.now + 1.5 * HOUR);
  assert.equal(f.doll.care.importAnalysis(report()).stale,true);
  assert.equal(f.doll.care.importAnalysis(report(f.now,12)).unchanged,true);
  assert.throws(() => f.doll.care.importAnalysis(report(f.now,15)), /different counts/);
  f.now++; f.doll.care.importAnalysis(report(f.now,0)); d = f.doll.snapshot(f.user);
  assert.equal(d.player.care.nextWettingAt,null); f.now += 5000 * HOUR;
  assert.equal(f.doll.snapshot(f.user).player.care.wetness,0); assert.equal(start.rhythm.reportId,"report-1000000");
});

test("pantry, hydration and activities have durable due times and one completion reward", t => {
  const f = fixture(t); let d = f.doll.snapshot(f.user); f.now += 3 * HOUR;
  d = f.doll.act(f.user,{action:"water"}); assert.equal(d.player.hydration,100); assert.equal(d.player.care.due.water,f.now + 2 * HOUR);
  assert.throws(() => f.doll.act(f.user,{action:"feed",food:"fake"}),/pantry/);
  d = f.doll.act(f.user,{action:"feed",food:"lunch"}); assert.equal(d.player.hunger,100);
  const count = d.player.careCount;
  d = f.doll.act(f.user,{action:"play"}); assert.equal(d.player.careCount,count);
  assert.throws(() => f.doll.act(f.user,{action:"rest"}), /current timed activity/);
  f.now = d.player.care.task.finishesAt - 1; assert.equal(f.doll.snapshot(f.user).player.careCount,count);
  f.now++; f.doll.tick(); d = f.doll.snapshot(f.user);
  assert.equal(d.player.careCount,count + 1); assert.equal(d.player.care.task,null);
  assert.equal(d.player.care.due.play,f.now + 3 * HOUR);
  assert.equal(f.doll.snapshot(f.user).player.careCount,count + 1);
  f.doll.act(f.user,{action:"rest"}); f.now += 100 * HOUR;
  d = f.doll.snapshot(f.user); assert.equal(d.player.energy,0);
  assert.equal(d.player.careCount,count + 2);
});

test("pet reminders require opt-in, coalesce episodes, cancel resolved needs and bind recipient identity", t => {
  const f = fixture(t); f.doll.snapshot(f.user); f.now += 12 * HOUR; f.doll.tick();
  const events = () => f.doll.care.events(user => f.identities.gameIdentity(user),user => f.doll.player(user));
  assert.equal(events().events.length,0);
  f.doll.act(f.user,{action:"reminders",enabled:true}); let page = events();
  assert.ok(page.events.some(e => e.kind === "cleanup")); assert.deepEqual(page.events[0].recipient,{issuer:f.identity.issuer,subject:f.identity.subject});
  assert.equal(JSON.stringify(page).includes("wettings"),false);
  const count = page.events.length; f.doll.tick(); assert.equal(events().events.length,count);
  wipe(f); f.doll.act(f.user,{action:"change",design:"cloud-tapes"}); assert.equal(events().events.some(e => e.kind === "cleanup"),false);
  f.doll.care.ack(events().events.map(e => e.id)); f.doll.tick(); assert.equal(events().events.length,0);
  f.doll.act(f.user,{action:"water"}); f.now += 3 * HOUR; f.doll.tick(); assert.ok(events().events.some(e => e.kind === "water"));
  assert.equal(f.doll.care.events(() => ({issuer:f.identity.issuer,subject:"another-person"}),user => f.doll.player(user)).events.length,0);
  f.doll.act(f.user,{action:"reminders",enabled:false}); assert.equal(events().events.length,0);
});

test("LAN bridge endpoints keep the public browser origin, require bearer auth and validate data", async t => {
  const f = fixture(t), token = "test-service-token-".repeat(3); f.config.petBridge = {token};
  const web = createDressupWeb(f.config,f.clothes,f.doll,f.sessions,f.catalog);
  const server = createServer(async (req,res) => { if (!await web(req,res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve)); f.config.origin = "https://bot.example";
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path,body,auth = token) => fetch(`http://127.0.0.1:${server.address().port}/littlepottchi/integration/v1/${path}`,{method:body ? "POST" : "GET",redirect:"error",
    headers:{Host:"10.1.1.23:4190",Authorization:`Bearer ${auth}`,"Content-Type":"application/json",Cookie:`diaper_session=${f.token}`},...(body ? {body:JSON.stringify(body)} : {})}); // Real HTTP requests model the LAN backend while browser SSO stays on the public HTTPS origin.
  assert.equal((await request("events",null,"wrong")).status,401);
  assert.equal((await request("analysis",report())).status,200);
  assert.equal((await request("analysis",{...report(),days:[]})).status,400);
  assert.equal((await request("events?limit=500")).status,400);
  assert.equal((await request("events/ack",{ids:[]})).status,200);
  assert.equal((await request("events/ack",{ids:["wrong"]})).status,400);
  assert.equal((await request("wallet")).status,404);
});
