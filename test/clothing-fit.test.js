import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clothingStrips, stanceStrips, profileKey } from "../src/dressup/web/fit.js";
import { dollLayers } from "../src/dressup/web/layers.js";
import { loadDressupCatalog, dressupRoot } from "../src/dressup/catalog.js";
import { fittingProfiles } from "../src/dressup/fitting.js";
import { renderDollPng } from "../src/dressup/render.js";

const catalog = loadDressupCatalog();
const rectProfile = (half, top = 380, bottom = 480) => [[top / 2, 0, 0, 0, 0], [(bottom - top) / 2, half, half, 0, 0], [(874 - bottom) / 2, 0, 0, 0, 0]];

test("reference pixel fitting expands fabric, preserves sleeves and caps extreme silhouette ratios", () => {
  const item = { image: "dress.png", slot: "top" }, diaper = { image: "diaper.png", bulk: 5 };
  const profiles = { "dress.png": rectProfile(30, 200, 650), "diaper.png": rectProfile(60) };
  const strips = clothingStrips(item, diaper, profiles);
  assert.deepEqual(strips[0], [0, 0, 387, 364, 0, 0, 387, 364]);
  const expanded = strips.find(s => s[1] === 420 && s[0] > 0 && s[2] < 250);
  assert.equal(expanded[6] / expanded[2], 2);
  assert.equal(expanded[7] / expanded[3], 1.3);
  const left = strips.find(s => s[1] === 420 && s[0] === 0);
  assert.equal(left[0], left[4]); assert.equal(left[2], left[6]);
  const pants = clothingStrips({ ...item, slot: "bottom" }, diaper, profiles);
  assert.ok(pants.every(s => s[1] === s[5] && s[3] === s[7]), "Pants do not acquire dress hem drop");
  assert.ok(pants.filter(s => s[1] > 479).every(s => s[2] === s[6]), "Smoothing cannot widen the tail below the diaper");
  profiles["diaper.png"] = rectProfile(180);
  assert.ok(clothingStrips(item, diaper, profiles).every(s => s[6] / s[2] <= 3.5));
  assert.equal(clothingStrips(item, null, profiles).length, 1);
  assert.equal(clothingStrips(item, { ...diaper, bulk: 1 }, profiles).length, 1);
  assert.equal(clothingStrips({ ...item, warp: "none" }, diaper, profiles).length, 1);
});

test("all packaged clothing and registered diaper silhouettes are available for fitting", () => {
  const profiles = JSON.parse(readFileSync(new URL("fit-profiles.json", dressupRoot), "utf8"));
  for (const item of [...catalog.clothes, ...catalog.diapers]) {
    for (const name of [profileKey(item), ...(item.parts || []), ...(item.backParts || [])]) {
      assert.ok(profiles[name], name);
      assert.equal(profiles[name].reduce((sum, row) => sum + row[0], 0), 437, name);
    }
  }
  const frilly = catalog.clothes.find(item => /NEWTQ_Clothing_FrillyDress_1A/.test(item.image));
  assert.equal(frilly.warp, "none", "Keep lidollquest's detailed-hem exception wearable without distorting its frills");
});

test("preserved trim follows the fabric instead of multiplying narrow edge pixels into spikes", () => {
  const top = { image: "uniform.png", slot: "top" }, diaper = { image: "diaper.png", bulk: 6 };
  const profiles = { "uniform.png": [[100, 0, 0, 0, 0], [221, 30, 30, 0, 0], [4, 5, 5, 0, 0], [112, 0, 0, 0, 0]],
    "diaper.png": rectProfile(60, 380, 660) };
  const peak = item => Math.max(...clothingStrips(item, diaper, profiles).map(s => s[6] / s[2]));
  assert.ok(peak(top) > 2.5, "Unprotected thin trim exaggerates the silhouette ratio");
  assert.ok(peak({ ...top, warpPreserveHem: true }) <= 2.000001, "Trim keeps the fabric's required 2x expansion");
});

test("multipart garments share one fit and narrow shoes follow each wide base without losing their native size", () => {
  const diaper = catalog.diapers.find(item => item.id === "ribbon-bouquet");
  const top = catalog.clothes.find(item => /TQ_Clothing_Onesie_1A/.test(item.image));
  const shoes = catalog.clothes.find(item => /Shoes_MaryJanes\.png/.test(item.image));
  const profiles = fittingProfiles({ diaper, top, outfit: { shoes } }, catalog);
  for (const shape of ["soft", "angular"]) {
    const state = { player: { shape, hair: catalog.hair[0], face: catalog.faces[0] }, outfit: { shoes }, diaper, top,
      base: catalog.bases[shape].wide, stance: "wide", fitProfiles: profiles };
    const layers = dollLayers(state), bodice = layers.find(l => l.image === top.image);
    for (const part of top.parts) assert.deepEqual(layers.find(l => l.image === part).strips, bodice.strips);
    const feet = stanceStrips(shoes, "wide", shape, profiles);
    assert.ok(feet.some(s => Math.abs(s[0] - s[4]) > 15));
    assert.ok(feet.every(s => s[2] === s[6]));
    assert.equal(stanceStrips(shoes, "narrow", shape, profiles), null);
  }
});

test("real PNG exports use clothing fitting rather than merely changing the base", async () => {
  const diaper = catalog.diapers.find(item => item.id === "ribbon-bouquet"), top = catalog.clothes.find(item => /TQ_Clothing_Onesie_1A/.test(item.image));
  const state = { player: { shape: "soft", hair: catalog.hair[0], face: catalog.faces[0] }, outfit: {}, diaper, top, base: catalog.bases.soft.wide };
  const fitted = await renderDollPng(state), flat = await renderDollPng({ ...state, fitProfiles: {} });
  assert.deepEqual([fitted.readUInt32BE(16), fitted.readUInt32BE(20)], [387, 875]);
  assert.notDeepEqual(fitted, flat);
});

test("school uniforms override imported no-warp rules and fit over Pearl diapers", async () => {
  const uniforms = catalog.clothes.filter(item => /School(?:girl)?Uniform/i.test(item.image));
  const pearl = catalog.diapers.find(item => item.id === "pearl-bloomers");
  assert.equal(uniforms.length, 6);
  for (const top of uniforms) {
    assert.equal(top.warp, "auto", top.name);
    assert.equal(top.warpPreserveHem, true, top.name);
    const profiles = fittingProfiles({ top, diaper: pearl }, catalog);
    assert.ok(clothingStrips(top, pearl, profiles).some(strip => strip[6] > strip[2] + 1), `${top.name} must expand over Pearl Bloomers`);
  }
  const top = uniforms.find(item => item.id === "tq-clothing-schoolgirluniform-3a");
  for (const diaper of catalog.diapers.filter(item => /^pearl-/.test(item.id))) {
    const profiles = fittingProfiles({ top, diaper }, catalog);
    assert.ok(clothingStrips(top, diaper, profiles).some(strip => strip[6] > strip[2] + 1));
  }
  const state = { player: { shape: "soft", hair: catalog.hair[0], face: catalog.faces[0] }, outfit: { top },
    top, diaper: pearl, base: catalog.bases.soft.wide };
  assert.notDeepEqual(await renderDollPng(state), await renderDollPng({ ...state, top: { ...top, warp: "none" }, outfit: {} }));
});

test("JSON round trips preserve back-section layering and do not double draw an equipped top", () => {
  const top = catalog.clothes.find(item => item.backParts?.length), diaper = catalog.diapers.find(item => item.id === "ribbon-bouquet");
  const state = { player: { shape: "soft", hair: catalog.hair[0], face: catalog.faces[0] }, outfit: { top }, top, diaper, base: catalog.bases.soft.wide };
  state.fitProfiles = fittingProfiles(state, catalog);
  const server = dollLayers(state), browser = dollLayers(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(browser, server);
  for (const image of top.backParts) assert.equal(browser.filter(layer => layer.image === image).length, 1);
});
