const images = new Map();
export function loadImage(name) {
  if (!images.has(name) && images.size >= 128) images.delete(images.keys().next().value); // Bound decoded-image retention while paging through a large wardrobe.
  if (!images.has(name)) images.set(name, new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => { images.delete(name); reject(new Error("A wardrobe image could not load. Refresh to try again.")); };
    img.src = `/clothes/art/${encodeURIComponent(name)}`;
  }));
  return images.get(name);
} // Cache decoded original assets without trimming their registration canvas.

export async function drawDoll(canvas, state) {
  const { player, outfit, base, diaper, top } = state;
  const generation = (canvas.generation || 0) + 1; canvas.generation = generation;
  const hairBack = player.hair.replace(/\.png$/, "_Back.png"), splitHair = /TQ_Hair_4_/.test(player.hair);
  const backLayers = [...new Set([top, ...Object.values(outfit)].filter(Boolean).flatMap(item => item.backParts || []))].map(image => ({ image }));
  const layers = [...backLayers, splitHair ? { image: hairBack } : null, { image: base }, { image: player.face },
    outfit.socks, outfit.underwear, diaper, outfit.bra, outfit.bottom, outfit.shoes, top, outfit.corset,
    outfit.belt, outfit.gloves, outfit.accessory, outfit.hand, outfit.bag,
    { image: splitHair ? player.hair.replace(/\.png$/, "_Front.png") : player.hair }, outfit.head].filter(Boolean)
    .flatMap(layer => [layer, ...(layer.parts || []).map(image => ({ image }))]); // Rejoin A/B/C garment sections at their native coordinates.
  const loaded = await Promise.all(layers.map(layer => loadImage(layer.image)));
  if (canvas.generation !== generation) return;
  const context = canvas.getContext("2d"); context.clearRect(0, 0, 387, 875);
  layers.forEach((layer, index) => context.drawImage(loaded[index], ...(layer.rect || [0, 0, 387, 875])));
  canvas.setAttribute("aria-label", `${player.name}, ${state.stance === "wide" ? "wide-legged" : "regular"} stance, wearing ${top?.name || outfit.corset?.name || outfit.bra?.name || "starter shirt"}`);
} // Load the full outfit before replacing the canvas, and discard stale asynchronous renders.

export async function thumbnail(canvas, item) {
  const all = await Promise.all([...(item.backParts || []), item.image, ...(item.parts || [])].map(loadImage)), art = all[0], context = canvas.getContext("2d");
  const [x, y, right, bottom] = item.bounds || [0, 0, art.width, art.height];
  const width = right - x, height = bottom - y, scale = Math.min(144 / width, 130 / height);
  for (const part of all) context.drawImage(part, x, y, width, height, (160 - width * scale) / 2, (150 - height * scale) / 2, width * scale, height * scale);
} // Gallery crops use alpha bounds while the equipped doll always uses the original canvas.
