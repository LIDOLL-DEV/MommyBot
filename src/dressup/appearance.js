import { GachaError } from "../gacha/store.js";

export const anatomyDefaults = { chest: "base", nipples: "none", genitals: "neutral", pubes: "none" };

export function updateAnatomy(catalog, player, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(anatomyDefaults, key))) throw new GachaError("Choose anatomy from the character creator.");
  const result = { ...player.anatomy };
  for (const [key, id] of Object.entries(input)) {
    if (typeof id !== "string" || !catalog.appearance[key].some(choice => choice.id === id)) throw new GachaError("Choose anatomy from the character creator.");
    result[key] = id;
  }
  player.anatomy = result;
} // Validate stable catalog IDs rather than accepting filenames, crop coordinates or client-authored layers.

export function anatomyLayers(catalog, player, diaper, outfit, top) {
  const anatomy = { ...anatomyDefaults, ...player.anatomy };
  const coveredChest = Boolean(top || outfit.bra || outfit.corset);
  const coveredBottom = Boolean(diaper || outfit.bottom);
  const groups = [...(coveredChest ? [] : ["chest", "nipples"]), ...(coveredBottom ? [] : ["pubes", "genitals"])];
  return groups.flatMap(key => catalog.appearance[key].find(choice => choice.id === anatomy[key]).layers);
} // Keep anatomy below clothing and suppress covered regions so larger overlays cannot protrude through garments.

export function bareCamera(catalog, player) {
  const id = player.anatomy?.genitals || anatomyDefaults.genitals;
  return catalog.appearance.genitals.find(choice => choice.id === id).camera;
} // Bare camera anatomy follows the saved preference independently of gender, physique or excitement.
