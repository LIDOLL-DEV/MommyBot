import test from "node:test";
import assert from "node:assert/strict";
import { dressupFixture } from "../scripts/fixtures/dressup.mjs";
import { LittlepottchiStore } from "../src/dressup/store.js";
import { HOUR } from "../src/dressup/care.js";

const fixture = t => { const f = dressupFixture(); t.after(() => f.close()); return f; };
const nextWet = f => { f.now = f.doll.player(f.user).care.nextWettingAt; return f.doll.snapshot(f.user); };
const wipe = f => {
  f.clothes.db.prepare("INSERT INTO care_supplies VALUES (?,1) ON CONFLICT(user_id) DO UPDATE SET wipes=wipes+1").run(f.user);
  return f.doll.act(f.user, { action:"wipe" });
}; // Supply fixtures bypass purchasing; camera/payment tests separately verify atomic wipe delivery.

for (const kind of ["wet", "mess"]) test(`${kind} accidents fill capacity without leaking, then gain 10% per overflow up to guaranteed leaks`, t => {
  const f = fixture(t); let draws = 0;
  f.doll.care.leakRandom = max => { assert.equal(max,100); draws++; return 99; };
  let d = f.doll.snapshot(f.user);
  if (kind === "mess") {
    f.doll.care.importAnalysis({reportId:"zero",finished:f.now,days:[{date:"2026-09-15",wettings:0,activeParticipants:1}]});
    d = f.doll.act(f.user,{action:"messy-mode",enabled:true});
  }
  const clock = kind === "wet" ? "nextWettingAt" : "nextMessAt", bulk = d.diaper.bulk;
  for (let count=1; count<=bulk+11; count++) {
    f.now = d.player.care[clock]; d = f.doll.snapshot(f.user);
    assert.equal(d.usedBulk,count,"Each accident uses one bulk unit");
    assert.equal(d.player.care.uncomfortable,count>=bulk);
    assert.equal(d.player.care.leaking,count>=bulk+10);
    assert.equal(d.player.care.needsWipe,count>=bulk+10);
    assert.equal(d.overflow.nextLeakChance,Math.min(100,Math.max(0,count+1-bulk)*10));
    if (count>=bulk) assert.ok(d.player.comfort<=35);
  }
  assert.equal(draws,9,"Only probabilistic accidents draw randomness; guaranteed events do not");
  assert.equal(d.player.care[kind === "wet" ? "bodyWetness" : "bodyMess"],2);
  assert.throws(()=>f.doll.act(f.user,{action:"change",design:"cloud-tapes"}),/baby wipe/);
  wipe(f); d = f.doll.act(f.user,{action:"change",design:"cloud-tapes"});
  assert.equal(d.player.care.uncomfortable,false); assert.equal(d.player.care.leaking,false); assert.equal(d.usedBulk,0);
});

test("boundary rolls, failed actions, reads and restart cannot replay leaks; only new escaped accidents require another wipe", t => {
  const f = fixture(t); let draws=0, roll=10;
  f.doll.care.leakRandom = () => { draws++; return roll; };
  let d=f.doll.snapshot(f.user);
  f.now=d.player.care.nextWettingAt+(d.diaper.bulk-1)*d.player.care.interval;
  d=f.doll.snapshot(f.user); assert.equal(draws,0);
  d=nextWet(f); assert.equal(d.player.care.leaking,false,"A draw of 10 misses a 10% chance");
  roll=19; f.now=d.player.care.nextWettingAt;
  assert.throws(()=>f.doll.act(f.user,{action:"change",design:"cloud-tapes"}),/baby wipe/);
  assert.equal(draws,2); // The rejected change still commits the newly due leak.
  for(let i=0;i<3;i++) {
    assert.equal(f.doll.snapshot(f.user).player.care.bodyWetness,1);
    assert.throws(()=>f.doll.act(f.user,{action:"change",design:"cloud-tapes"}),/baby wipe/);
  }
  assert.equal(draws,2);
  f.doll=new LittlepottchiStore(f.clothes,f.diapers,f.catalog,()=>f.now);
  f.doll.care.leakRandom=()=>{throw Error("A persisted accident must not reroll");};
  assert.equal(f.doll.snapshot(f.user).player.care.leaking,true);
  d=wipe(f); assert.equal(d.player.care.needsWipe,false); assert.equal(d.player.care.leaking,true);
  const cleanRevision=d.player.care.cleanupRevision;
  f.doll.care.leakRandom=()=>99;
  d=nextWet(f); assert.equal(d.player.care.needsWipe,false,"An old leak does not make a later contained accident require a wipe");
  f.doll.care.leakRandom=()=>0;
  d=nextWet(f); assert.equal(d.player.care.needsWipe,true); assert.equal(d.player.care.bodyWetness,1);
  assert.equal(d.player.care.cleanupRevision,cleanRevision,"A fresh cleanup episode uses the revision set by the previous wipe");
});

test("offline and incremental care resolve mixed accidents in the same order, including tied timestamps", t => {
  const run = incremental => {
    const f=fixture(t), rolls=[99,0,99,99]; let draws=0;
    f.doll.care.leakRandom=()=>{assert.ok(draws<rolls.length);return rolls[draws++];};
    f.doll.act(f.user,{action:"messy-mode",enabled:true}); const start=f.now;
    if(incremental) for(const hour of [4,8,12,16]) {f.now=start+hour*HOUR;f.doll.snapshot(f.user);}
    f.now=start+20*HOUR;
    const d=f.doll.snapshot(f.user), c=d.player.care;
    return {draws,wet:c.wetness,mess:c.mess,bodyWet:c.bodyWetness,bodyMess:c.bodyMess,nextWet:c.nextWettingAt,nextMess:c.nextMessAt};
  };
  const offline=run(false);
  assert.deepEqual(offline,run(true));
  assert.equal(offline.draws,4); assert.equal(offline.wet,5); assert.equal(offline.mess,1);
  assert.equal(offline.bodyWet,0); assert.equal(offline.bodyMess,1,"Only the actual leaking messy accident soils the doll");
});

test("very long wet-only absences batch certain outcomes and legacy saved leaks keep their cleanup", t => {
  const f=fixture(t); let draws=0;
  f.doll.care.leakRandom=()=>{draws++; return 99;};
  let d=f.doll.snapshot(f.user);
  f.now=d.player.care.nextWettingAt+999999*d.player.care.interval;
  d=f.doll.snapshot(f.user); assert.equal(d.player.care.wetness,1000000); assert.equal(draws,9);
  assert.equal(d.player.care.bodyWetness,1000000-d.diaper.bulk-9);
  delete d.player.care.needsWipe; delete d.player.care.uncomfortable;
  f.doll.save(f.user,d.player);
  f.doll.care.leakRandom=()=>{throw Error("Migration must not reroll accidents");};
  d=f.doll.snapshot(f.user); assert.equal(d.player.care.needsWipe,true); assert.equal(d.player.care.leaking,true);
  assert.equal(d.player.care.uncomfortable,true);
});
