import { randomInt } from "node:crypto";

export const BETS = Object.freeze([1, 5, 10, 25, 50, 100]);
export const WIDTH = 10, HEIGHT = 20;
export class BallDropError extends Error {}
export const ballDropConfig = (env = process.env) => ({ enabled: env.BALLDROP_ENABLED !== "false" }); // Pausing new bets keeps existing payment recovery available.

export function ballPath(draw = randomInt) {
  const path = [4 + draw(4)];
  for (let row = 0; row < HEIGHT; row++) {
    const next = path.at(-1) + (draw(2) === 0 ? -1 : 1);
    path.push(next < 1 ? 2 : next > WIDTH ? WIDTH - 1 : next);
  }
  return path;
} // Choose one of four middle entry pins, bounce left/right at each row, and reflect at the field walls.

export function payout(bet, guess, landing) {
  const distance = Math.abs(guess - landing);
  return distance === 0 ? bet * 2 : distance === 1 ? Math.ceil(bet * 3 / 2) : distance === 2 ? bet : 0;
} // Returns include the stake; round half coins up because the online wallet accepts only whole coins.
