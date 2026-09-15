import test from "node:test";
import assert from "node:assert/strict";
import { dressupFixture } from "../scripts/fixtures/dressup.mjs";
import { anatomyDefaults, anatomyLayers } from "../src/dressup/appearance.js";

const fixture = t => { const f = dressupFixture(); t.after(() => f.close()); return f; };
const edit = (f, extra) => {
  const p = f.doll.player(f.user);
  return f.doll.act(f.user,{action:"appearance",name:p.name,gender:p.gender,shape:p.shape,hair:p.hair,face:p.face,...extra});
};

test("the creator exposes registered anatomy and separate hairstyle/color choices", t => {
  const f = fixture(t), a = f.catalog.appearance;
  assert.equal(a.chest.length,2); assert.equal(a.nipples.length,3); assert.equal(a.genitals.length,7); assert.equal(a.pubes.length,4);
  assert.equal(new Set(a.hair.map(choice => choice.style)).size,4);
  for (const choice of a.hair) assert.ok(f.catalog.hair.includes(choice.image));
  assert.deepEqual(f.catalog.provenance["TQ_Pubes_1.png"].size,[1548,3500]);
  for (const key of Object.keys(anatomyDefaults)) for (const choice of a[key]) for (const layer of choice.layers) assert.ok(f.catalog.provenance[layer.image]);
});

test("anatomy choices and bare cameras are independent of gender and body, with existing care clocks preserved", t => {
  const f = fixture(t); let d = f.doll.act(f.user,{action:"equip",slot:"diaper",design:null});
  const next = d.player.care.nextWettingAt;
  for (const shape of ["soft","angular"]) for (const choice of f.catalog.appearance.genitals) {
    d = edit(f,{shape,gender:"Nonbinary",anatomy:{genitals:choice.id}});
    assert.equal(d.buttcam.image,choice.camera); assert.equal(d.player.gender,"Nonbinary");
    assert.equal(d.player.care.nextWettingAt,next); assert.equal(d.player.diaperFree,true);
  }
  const saved = d.player.anatomy;
  assert.deepEqual(edit(f,{name:"New name"}).player.anatomy,saved);
  f.seed(f.diapers,"ribbon-bouquet");
  d = f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"});
  assert.equal(d.stance,"wide"); assert.deepEqual(d.player.anatomy,saved);
  assert.ok(!d.bodyLayers.some(layer => /Penis|Pubes/.test(layer.image)));
});

test("anatomy sits below clothing, pubic hair sits below genitals and invalid choices cannot mutate saves", t => {
  const f = fixture(t), anatomy = {chest:"breasts",nipples:"style-2",genitals:"penis-5",pubes:"style-3"};
  const d = edit(f,{anatomy});
  assert.deepEqual(anatomyLayers(f.catalog,d.player,null,{},null).map(layer => layer.image),
    ["TQ_Breasts_1.png","TQ_Nipples_2.png","TQ_Pubes_3.png","TQ_Penis_5.png"]);
  assert.deepEqual(anatomyLayers(f.catalog,d.player,d.diaper,{bra:{},bottom:{}},null),[]);
  for (const bad of [{genitals:"../../file"},{chest:"missing"},{pubes:1},{unknown:"style-1"},[],null]) {
    assert.throws(() => edit(f,{anatomy:bad}),/Choose anatomy/);
    assert.deepEqual(f.doll.player(f.user).anatomy,anatomy);
  }
  const player = f.doll.player(f.user); delete player.anatomy; f.doll.save(f.user,player);
  assert.deepEqual(f.doll.player(f.user).anatomy,anatomyDefaults);
  assert.equal(f.coins,1000);
});
