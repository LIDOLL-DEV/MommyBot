import { randomInt } from "node:crypto";

export const BETS = Object.freeze([1, 5, 10, 25, 50, 100]);
export const WIDTH = 10, HEIGHT = 20;
export const OBSTACLES = Object.freeze([
  [3, 1, "bomb"], [3, 6, "block"], [4, 4, "block"], [4, 9, "bomb"],
  [6, 3, "bomb"], [6, 7, "block"], [7, 1, "block"], [7, 5, "bomb"],
  [8, 9, "block"], [9, 4, "block"], [10, 2, "bomb"], [10, 7, "bomb"],
  [12, 3, "block"], [12, 6, "block"], [13, 9, "bomb"], [14, 1, "block"],
  [14, 5, "bomb"], [15, 8, "block"], [16, 3, "bomb"], [17, 6, "block"],
  [1, 3, "coin"], [2, 7, "coin"], [5, 2, "coin"], [8, 6, "coin"],
  [11, 8, "coin"], [15, 4, "coin"], [18, 2, "coin"], [18, 9, "coin"],
].map(([row, column, type]) => Object.freeze({ row, column, type })));
export const COIN_REWARD = Object.freeze({ min: 1, max: 5 });
export const BLAST_DIRECTIONS = Object.freeze([
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
].map(direction => Object.freeze(direction))); // Eight equally likely compass directions, stored as column/row offsets.
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

function reflect(value, minimum, maximum) {
  while (value < minimum || value > maximum) value = value < minimum ? minimum * 2 - value : maximum * 2 - value;
  return value;
} // Reflect a blast at the walls or ceiling so its landing remains inside the field.

export function obstacleDrop(draw = randomInt, obstacles = OBSTACLES) {
  const layout = obstacles.map(obstacle => ({ ...obstacle })), cells = new Map(), spent = new Set();
  for (const obstacle of layout) {
    const key = `${obstacle.row}:${obstacle.column}`;
    if (!Number.isInteger(obstacle.row) || obstacle.row < 1 || obstacle.row >= HEIGHT || !Number.isInteger(obstacle.column) || obstacle.column < 1 || obstacle.column > WIDTH || !["block", "bomb", "coin"].includes(obstacle.type) || cells.has(key)) throw new BallDropError("Invalid obstacle layout.");
    cells.set(key, obstacle.type);
  }
  const trajectory = [{ row: 0, column: 4 + draw(4) }];
  let bonus = 0;
  while (trajectory.at(-1).row < HEIGHT) {
    const point = trajectory.at(-1), key = `${point.row}:${point.column}`, type = cells.get(key);
    let column, row;
    if (type === "bomb" && !spent.has(key)) {
      spent.add(key); point.hit = "bomb";
      const [dx, dy] = BLAST_DIRECTIONS[draw(BLAST_DIRECTIONS.length)], distance = 2 + draw(2);
      column = reflect(point.column + dx * distance, 1, WIDTH);
      row = Math.min(HEIGHT, Math.abs(point.row + dy * distance)); // Reflect at the ceiling, but let a downward blast finish in a bottom pocket.
    } else {
      if (type === "block") point.hit = "block";
      if (type === "coin" && !spent.has(key)) {
        spent.add(key); point.hit = "coin";
        point.coins = COIN_REWARD.min + draw(COIN_REWARD.max - COIN_REWARD.min + 1); bonus += point.coins;
      } // A bomb may bring the ball back to a coin peg, but each peg pays only once during this drop.
      column = reflect(point.column + (draw(2) === 0 ? -1 : 1) * (type === "block" ? 2 : 1), 1, WIDTH);
      row = point.row + 1;
    }
    trajectory.push({ row, column });
  }
  return { obstacles: layout, trajectory, path: trajectory.map(point => point.column), bonus };
} // Save collisions and upward/sideways blasts; single-use bombs guarantee gravity eventually reaches a pocket.

export function payout(bet, guess, landing) {
  const distance = Math.abs(guess - landing);
  return distance === 0 ? bet * 2 : distance === 1 ? Math.ceil(bet * 3 / 2) : distance === 2 ? bet : 0;
} // Returns include the stake; round half coins up because the online wallet accepts only whole coins.
