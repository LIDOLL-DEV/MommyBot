export function selectButtcam(catalog, player, diaper) {
  if (!diaper) return { image: catalog.bareCameras[player.shape], frame: 0, label: "Diaper-free camera", note: "" };
  const frame = player.care.messyMode ? Math.min(player.care.mess, diaper.buttcams.length - 1) : 0;
  return { image: diaper.buttcams[frame], frame, label: frame ? "Messy diaper camera" : "Clean diaper camera", note: diaper.buttcamNote || "" };
} // Frame zero is always clean; wettings never select messy art, and disabling messy mode returns to clean art immediately.
