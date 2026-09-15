export function dollLayers({ player, outfit, base, diaper, top, bodyLayers = [] }) {
  const splitHair = /TQ_Hair_4_/.test(player.hair);
  const backLayers = [...new Set([top, ...Object.values(outfit)].filter(Boolean).flatMap(item => item.backParts || []))].map(image => ({ image }));
  return [...backLayers, splitHair ? { image: player.hair.replace(/\.png$/, "_Back.png") } : null,
    { image: base }, ...bodyLayers, { image: player.face }, outfit.socks, diaper, outfit.bra, outfit.bottom,
    outfit.shoes, top, outfit.corset, outfit.belt, outfit.gloves, outfit.accessory, outfit.hand, outfit.bag,
    { image: splitHair ? player.hair.replace(/\.png$/, "_Front.png") : player.hair }, outfit.head].filter(Boolean)
    .flatMap(layer => [layer, ...(layer.parts || []).map(image => ({ image }))]);
} // Browser and Discord exports share the same registered layer order, including split hair and garment sections.
