import { GachaError } from "../gacha/store.js";

export const excitementRules = {
  max: 255, gainPerHour: 12,
  toys: [
    { id: "pocket", name: "Pocket toy", duration: 60000, relief: 85 },
    { id: "wand", name: "Wand", duration: 120000, relief: 170 },
    { id: "dual", name: "Dual-mode toy", duration: 180000, relief: 255 },
  ],
}; // Abstract adult-character stats; all toys are reusable menu actions available to every gender.

export function advanceExcitement(player, now) {
  const care = player.care;
  care.toy ??= null; care.completedToy ??= null;
  if (player.excitement === undefined) { player.excitement = 0; return; } // New and migrated dolls start at zero without inventing past buildup.
  let from = player.updated;
  if (care.toy) {
    const toy = care.toy, until = Math.min(now, toy.finishesAt);
    const elapsed = Math.max(0, until - Math.max(from, toy.started));
    player.excitement = Math.max(0, player.excitement - elapsed * toy.relief / (toy.finishesAt - toy.started));
    from = Math.max(from, until);
    if (now >= toy.finishesAt) {
      care.completedToy = { name: toy.name, finished: toy.finishesAt }; care.toy = null;
      player.careCount++;
    }
  } // Relief accrues only during elapsed session time; a completed session is recorded once, including offline.
  player.excitement = Math.min(excitementRules.max, Math.max(0, player.excitement + Math.max(0, now - from) * excitementRules.gainPerHour / 3600000));
} // Pause buildup while a toy runs, then resume at its finish time rather than at the next browser visit.

export function useToy(player, input, now) {
  if (input.action === "stop-toy") { player.care.toy = null; return; } // Stopping retains only relief already earned; it grants no completion reward.
  const toy = excitementRules.toys.find(item => item.id === input.toy);
  if (!toy) throw new GachaError("Choose a toy from the menu.");
  if (player.care.toy) {
    if (player.care.toy.id === toy.id) return;
    throw new GachaError("Stop the current toy before activating another.");
  }
  if (player.excitement <= 0) throw new GachaError("The excitement meter is already settled.");
  player.care.toy = { ...toy, started: now, finishesAt: now + toy.duration };
  player.care.completedToy = null;
} // The server chooses duration and relief; duplicate activation cannot restart a running session.
