import { dollLayers } from "./layers.js";
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
  const layers = dollLayers(state);
  const loaded = await Promise.all(layers.map(layer => loadImage(layer.image)));
  if (canvas.generation !== generation) return;
  const context = canvas.getContext("2d"); context.clearRect(0, 0, 387, 875);
  layers.forEach((layer, index) => {
    if (layer.strips) for (const strip of layer.strips) context.drawImage(loaded[index], ...strip);
    else context.drawImage(loaded[index], ...(layer.sourceRect || []), ...(layer.rect || [0, 0, 387, 875]));
  }); // Browser and Pillow consume the same source/destination rectangles for fitted clothing.
  const clothing = top?.name || outfit.corset?.name || outfit.bra?.name;
  canvas.setAttribute("aria-label", `${player.name}, ${state.stance === "wide" ? "wide-legged" : "regular"} stance, ${clothing ? `wearing ${clothing}` : "no top equipped"}`);
} // Load the full outfit before replacing the canvas, and discard stale asynchronous renders.

export async function thumbnail(canvas, item) {
  const all = await Promise.all([...(item.backParts || []), item.image, ...(item.parts || [])].map(loadImage)), art = all[0], context = canvas.getContext("2d");
  const [x, y, right, bottom] = item.bounds || [0, 0, art.width, art.height];
  const width = right - x, height = bottom - y, scale = Math.min(144 / width, 130 / height);
  for (const part of all) context.drawImage(part, x, y, width, height, (160 - width * scale) / 2, (150 - height * scale) / 2, width * scale, height * scale);
} // Gallery crops use alpha bounds while the equipped doll always uses the original canvas.
