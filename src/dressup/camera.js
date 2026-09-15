import { bareCamera } from "./appearance.js";

export function selectButtcam(catalog, player, diaper) {
  if (!diaper) return { image: bareCamera(catalog, player), frame: 0, label: "Diaper-free camera", note: player.anatomy?.genitals?.startsWith("penis-") ? "Shared camera for all five styles." : "" };
  const frame = player.care.messyMode ? Math.min(player.care.mess, diaper.buttcams.length - 1) : 0;
  return { image: diaper.buttcams[frame], frame, label: frame ? "Messy diaper camera" : "Clean diaper camera", note: diaper.buttcamNote || "" };
} // Frame zero is always clean; wettings never select messy art, and disabling messy mode returns to clean art immediately.
