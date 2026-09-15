import { readFileSync } from "node:fs";
import { profileKey } from "./web/fit.js";

let profiles;
export function fittingProfiles({ outfit = {}, top, diaper }, catalog) {
  profiles ||= JSON.parse(readFileSync(new URL("../../assets/dressup/fit-profiles.json", import.meta.url), "utf8"));
  const names = new Set(Object.values(catalog.bases).flatMap(group => Object.values(group)));
  for (const item of [top, diaper, ...Object.values(outfit)].filter(Boolean)) {
    names.add(profileKey(item));
    for (const image of [...(item.parts || []), ...(item.backParts || [])]) names.add(image);
  }
  return Object.fromEntries([...names].map(name => {
    if (!profiles[name]) throw new Error(`Missing clothing profile: ${name}. Run python/bake_clothing_profiles.py.`);
    return [name, profiles[name]];
  }));
} // Send only the equipped silhouettes and four bases, never the entire wardrobe profile database.
