import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { loadDressupCatalog } from "../src/dressup/catalog.js";
import { renderDollPng, DollRenderError } from "../src/dressup/render.js";

try {
  if (process.argv[2]) {
    const settings = dotenv.parse(readFileSync(process.argv[2]));
    if (settings.LITTLEPOTTCHI_PYTHON) process.env.LITTLEPOTTCHI_PYTHON = settings.LITTLEPOTTCHI_PYTHON;
  } // Read only the renderer setting as data; never shell-source service credentials or print them.
  const catalog = loadDressupCatalog(), diaper = catalog.diapers.find(item => item.stance === "wide");
  const png = await renderDollPng({player:{hair:catalog.hair.find(name=>/TQ_Hair_4_/.test(name)),face:catalog.faces[0]},
    base:catalog.bases.soft.wide,diaper,top:catalog.clothes.find(item=>/TShirt_1A/.test(item.image)),outfit:{},bodyLayers:[]});
  if (png.readUInt32BE(16)!==387 || png.readUInt32BE(20)!==875) throw new Error("Unexpected dimensions");
  console.log("Littlepottchi PNG renderer ready: Python/Pillow and packaged assets produced a 387x875 image.");
} catch (error) {
  console.error(error instanceof DollRenderError ? error.message : "PNG preflight failed. Check configuration-file access and the complete assets/dressup catalog.");
  process.exitCode=1;
} // Render a synthetic dressed doll in memory: no live database, Discord connection or image file is created.
