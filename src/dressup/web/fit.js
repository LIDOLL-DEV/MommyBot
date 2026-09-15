const W = 387, H = 875;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const profileKey = item => item.image + (item.rect ? `:${item.rect.join(",")}` : "");

function smooth(values, kernel) {
  const sum = kernel.reduce((a, b) => a + b), radius = Math.floor(kernel.length / 2);
  for (let pass = 0; pass < 2; pass++) {
    const source = values.slice();
    values = source.map((_, i) => kernel.reduce((total, weight, k) => total + weight * source[clamp(i + k - radius, 0, source.length - 1)], 0) / sum);
  }
  return values;
} // Match lidollquest's two smoothing passes without reading partially updated rows.

function decode(runs) {
  const rows = [];
  for (const [count, ...edges] of runs) for (let i = 0; i < count * 2; i++) rows.push(edges);
  rows.push([0, 0, 0, 0]);
  return rows;
} // Restore the reference scanner's half-resolution, block-filled source rows.

function silhouette(images, profiles) {
  const rows = images.map(name => decode(profiles[name]));
  const left = [], right = [], half = [];
  let top = H, bottom = 0;
  for (let y = 0; y < H; y++) {
    left[y] = Math.max(...rows.map(r => r[y][0])); right[y] = Math.max(...rows.map(r => r[y][1]));
    half[y] = Math.max(left[y], right[y]);
    if (half[y] > 0) { top = Math.min(top, y); bottom = y; }
  }
  const l = smooth(left, [1, 2, 3, 2, 1]), r = smooth(right, [1, 2, 3, 2, 1]);
  let skew = 0, count = 0;
  for (let y = Math.max(top, bottom - 200); y <= bottom; y++) if (l[y] + r[y] > 0) { skew += Math.abs(l[y] - r[y]) / (l[y] + r[y]); count++; }
  return { top, bottom, half: smooth(half, [1, 2, 3, 2, 1]), left: l, right: r, skew: count ? skew / count : 0 };
} // Profile assembled sections together so a bodice, waistband and hem share one continuous warp.

export function clothingStrips(item, diaper, profiles) {
  const full = [[0, 0, W, H, 0, 0, W, H]];
  if (!diaper || diaper.bulk <= 1 || !["top", "bottom", "belt", "corset"].includes(item.slot) || item.warp === "none") return full;
  const names = [item.image, ...(item.parts || []), ...(item.backParts || [])];
  if (!profiles?.[profileKey(diaper)] || names.some(name => !profiles[name])) return full;
  const garment = silhouette(names, profiles), padding = silhouette([profileKey(diaper)], profiles);
  if (garment.top >= garment.bottom || padding.top >= padding.bottom) return full;
  const dress = item.slot === "top", fullHem = item.warpFullHem === true;
  const start = Math.max(0, padding.top - 16), end = Math.min(H, padding.bottom + (fullHem ? 80 : 40));
  const bands = [], average = (p, y, h) => (p[y] + 2 * p[Math.floor(y + h / 2)] + p[y + h - 1]) / 4;
  for (let y = start; y < end; y += 4) {
    const h = Math.min(4, end - y), g = average(garment.half, y, h), d = average(padding.half, y, h);
    bands.push({ y, h, raw: g > 4 && d > g ? clamp(d / g, 1, 3.5) : 1 });
  }
  const stretches = smooth(bands.map(b => b.raw), [1, 2, 1]);
  const strips = start ? [[0, 0, W, start, 0, 0, W, start]] : [];
  let push = 0;
  for (let i = 0; i < bands.length; i++) {
    const { y, h, raw } = bands[i];
    let stretch = stretches[i];
    if (y < padding.top) stretch = 1 + (stretch - 1) * (y - start) / Math.max(1, padding.top - start);
    if (y > padding.bottom) stretch = Math.min(stretch, Math.max(1, raw));
    stretch = Math.max(1, stretch);
    const boost = dress ? 1 + (stretch - 1) * 0.3 : 1;
    const t = clamp((y + h / 2 - 300) / 160, 0, 1);
    const left = dress ? Math.round(145 - 90 * t + 12) : 0, right = dress ? Math.round(275 + 40 * t - 12) : W;
    const width = right - left, extra = width * (stretch - 1);
    let shift = extra / 2;
    if (garment.skew > 0.25 && garment.left[y] + garment.right[y] > 0)
      shift += (garment.left[y] - garment.right[y]) / (garment.left[y] + garment.right[y]) * extra / 2;
    strips.push([left, y, width, h, left - shift, y + push, width * stretch, h * boost]);
    if (dress) {
      strips.push([0, y, left, h, 0, y + push, left, h * boost]);
      strips.push([right, y, W - right, h, right, y + push, W - right, h * boost]);
    } // Draw sleeves after the expanded centre, at their original horizontal positions.
    push += h * (boost - 1);
  }
  if (end < H) {
    if (fullHem && !dress) {
      const depth = Math.min(150, H - end), g = garment.half[padding.bottom], d = padding.half[padding.bottom];
      const scale = 1 + (g > 0 && d > g ? clamp((d / g - 1) / 0.2, 0, 1) : 0) * 0.35;
      strips.push([0, end, W, depth, 0, end, W, depth * scale]);
      if (end + depth < H) strips.push([0, end + depth, W, H - end - depth, 0, end + depth * scale, W, H - end - depth]);
    } else strips.push([0, end, W, H - end, 0, end + push, W, H - end]);
  }
  return strips;
} // Port tq_draw_dress_warped/tq_draw_pants_warped pixel mode: 4px bands, 3.5x cap, 16px lead-in, taper clamp and hem drop.

export function stanceStrips(item, stance, shape, profiles) {
  const native = item.stances?.length === 1 ? item.stances[0] : "narrow";
  if (native === stance || !["shoes", "socks"].includes(item.slot)) return null;
  const bases = shape === "angular" ? { narrow: "TQ_Base_2.png", wide: "DQ_Base_4.png" } : { narrow: "TQ_Base_3.png", wide: "DQ_Base_2.png" };
  if (!profiles?.[bases[native]] || !profiles[bases[stance]]) return null;
  const source = decode(profiles[bases[native]]), target = decode(profiles[bases[stance]]);
  const offsets = [0, 1].map(side => smooth(source.map((row, y) => {
    // Use the nearest ankle rows for shoe pixels below the base silhouette.
    const probe = clamp(y, 500, 780), a = source[probe], b = target[probe];
    return (side ? 1 : -1) * ((b[side] + b[side + 2]) - (a[side] + a[side + 2])) / 2;
  }), [1, 2, 3, 2, 1]));
  const strips = [[0, 0, W, 500, 0, 0, W, 500]];
  for (let y = 500; y < H; y += 4) for (let side = 0; side < 2; side++) {
    const probe = source[clamp(y, 500, 780)];
    const split = Math.round(W / 2 + (probe[3] - probe[2]) / 2);
    const x = side ? split : 0, width = side ? W - split : split, h = Math.min(4, H - y);
    strips.push([x, y, width, h, x + offsets[side][y] * clamp((y - 500) / 60, 0, 1), y, width, h]);
  }
  return strips;
} // Littlepottchi switches bases: move each stocking/shoe with its leg instead of rejecting narrow-stance art.

export function fitStrips(item, diaper, stance, shape, profiles) {
  return stanceStrips(item, stance, shape, profiles) || clothingStrips(item, diaper, profiles);
} // Shoes and stockings follow the legs; dresses and skirts retain their fabric-fitting rules.
