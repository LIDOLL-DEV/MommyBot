import { fitStrips } from "./fit.js";

export function dollLayers({ player, outfit, base, diaper, top, bodyLayers = [], fitProfiles, stance = diaper?.stance || "narrow" }) {
  const splitHair = /TQ_Hair_4_/.test(player.hair);
  const fitted = new Map();
  const fit = item => {
    if (!fitted.has(item)) fitted.set(item, fitStrips(item, diaper, stance, player.shape, fitProfiles));
    return fitted.get(item);
  }; // Reuse one strip plan across all sections of the same garment.
  const garments = [top, ...Object.values(outfit)].filter(Boolean);
  const backLayers = [...new Map(garments.flatMap(item => (item.backParts || []).map(image => [image, { image, strips: fit(item) }]))).values()];
  // Deduplicate by filename: JSON snapshots do not preserve top/outfit object identity in the browser.
  return [...backLayers, splitHair ? { image: player.hair.replace(/\.png$/, "_Back.png") } : null,
    { image: base }, ...bodyLayers, { image: player.face }, outfit.socks, diaper, outfit.bra, outfit.bottom,
    outfit.shoes, top, outfit.corset, outfit.belt, outfit.gloves, outfit.accessory, outfit.hand, outfit.bag,
    { image: splitHair ? player.hair.replace(/\.png$/, "_Front.png") : player.hair }, outfit.head].filter(Boolean)
    .flatMap(layer => {
      const strips = layer.strips || (layer.slot && layer.slot !== "diaper" ? fit(layer) : undefined);
      return [{ ...layer, strips }, ...(layer.parts || []).map(image => ({ image, strips }))];
    });
} // Browser and Discord exports share the same registered layer order, including split hair and garment sections.
