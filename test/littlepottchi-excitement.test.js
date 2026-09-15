import test from "node:test";
import assert from "node:assert/strict";
import { dressupFixture } from "../scripts/fixtures/dressup.mjs";
import { LittlepottchiStore } from "../src/dressup/store.js";
import { HOUR } from "../src/dressup/care.js";

const fixture = t => { const f = dressupFixture(); t.after(() => f.close()); return f; };
const level = f => f.doll.snapshot(f.user).player.excitement;

test("excitement migrates at zero, grows with elapsed time and caps at the shared 255 maximum", t => {
  const f = fixture(t); assert.equal(level(f),0);
  f.now += 4 * HOUR; assert.equal(level(f),48); assert.equal(level(f),48);
  f.now += 100 * HOUR; assert.equal(level(f),255);
  const player = f.doll.player(f.user); delete player.excitement; delete player.care.toy;
  f.doll.save(f.user,player); f.now += 100 * HOUR;
  assert.equal(level(f),0); assert.equal(f.doll.player(f.user).care.toy,null);
});

test("toys apply timed relief once, retain deadlines on duplicate clicks and resume buildup after offline completion", t => {
  const f = fixture(t); level(f); f.now += 30 * HOUR;
  const before = f.doll.snapshot(f.user), started = f.doll.act(f.user,{action:"toy",toy:"dual",relief:999999,duration:1});
  assert.equal(started.player.excitement,255); assert.equal(started.player.care.toy.finishesAt,f.now + 180000);
  const deadline = started.player.care.toy.finishesAt, nextWet = started.player.care.nextWettingAt;
  f.now += 60000;
  const repeated = f.doll.act(f.user,{action:"toy",toy:"dual"});
  assert.equal(repeated.player.excitement,170); assert.equal(repeated.player.care.toy.finishesAt,deadline);
  assert.throws(() => f.doll.act(f.user,{action:"toy",toy:"wand"}),/Stop the current/);
  f.doll = new LittlepottchiStore(f.clothes,f.diapers,f.catalog,() => f.now);
  assert.equal(level(f),170); assert.equal(f.doll.player(f.user).care.nextWettingAt,nextWet);
  f.now = deadline + HOUR;
  const completed = f.doll.snapshot(f.user);
  assert.equal(completed.player.excitement,12); assert.equal(completed.player.care.toy,null);
  assert.equal(completed.player.care.completedToy.finished,deadline);
  assert.equal(completed.player.careCount,before.player.careCount + 1);
  assert.equal(f.doll.snapshot(f.user).player.careCount,completed.player.careCount);
  assert.equal(f.coins,1000);
});

test("stopping retains earned relief without a completion reward; invalid and zero-level starts fail", t => {
  const f = fixture(t); assert.throws(() => f.doll.act(f.user,{action:"toy",toy:"fake"}),/Choose a toy/);
  assert.throws(() => f.doll.act(f.user,{action:"toy",toy:"pocket"}),/already settled/);
  assert.equal(level(f),0); // Persist the initial visit; rejected actions correctly roll their migration back.
  f.now += 10 * HOUR;
  const started = f.doll.act(f.user,{action:"toy",toy:"pocket"}), count = started.player.careCount;
  f.now += 30000;
  const stopped = f.doll.act(f.user,{action:"stop-toy"});
  assert.equal(stopped.player.excitement,77.5); assert.equal(stopped.player.careCount,count);
  assert.equal(stopped.player.care.toy,null); assert.equal(stopped.player.care.completedToy,null);
  f.now += HOUR; assert.equal(level(f),89.5);
});

test("gender is optional, independent of shape, preserved by older clients and cannot alter toy rules", t => {
  const f = fixture(t), original = f.doll.snapshot(f.user).player;
  const input = {action:"appearance",name:original.name,shape:"angular",hair:original.hair,face:original.face};
  const doll = f.doll.act(f.user,{...input,gender:"Nonbinary"});
  assert.equal(doll.player.gender,"Nonbinary"); assert.equal(doll.player.shape,"angular");
  assert.equal(f.doll.act(f.user,{...input,shape:"soft"}).player.gender,"Nonbinary");
  assert.throws(() => f.doll.act(f.user,{...input,gender:"a".repeat(33)}),/32 characters/);
  assert.throws(() => f.doll.act(f.user,{...input,gender:{}}),/32 characters/);
  assert.equal(f.doll.act(f.user,{...input,gender:""}).player.gender,"");
});
