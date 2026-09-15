import { randomInt } from "node:crypto";

export const BETS = Object.freeze([1, 5, 10, 25, 50, 100]);
export const WIDTH = 10, HEIGHT = 20;
export const OBSTACLE_COUNTS = Object.freeze({ block: 11, bomb: 9, coin: 8 });
export const COIN_REWARD = Object.freeze({ min: 1, max: 5 });
export const BLAST_DIRECTIONS = Object.freeze([
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
].map(direction => Object.freeze(direction))); // Eight equally likely compass directions, stored as column/row offsets.
export class BallDropError extends Error {}
export const ballDropConfig = (env = process.env) => ({ enabled: env.BALLDROP_ENABLED !== "false" }); // Pausing new bets keeps existing payment recovery available.

export function randomObstacles(draw = randomInt) {
  const cells = Array.from({ length: (HEIGHT - 1) * WIDTH }, (_, index) => ({ row: 1 + Math.floor(index / WIDTH), column: 1 + index % WIDTH }));
  const layout = [];
  for (const [type, count] of Object.entries(OBSTACLE_COUNTS)) for (let n = 0; n < count; n++) {
    const selected = draw(cells.length);
    layout.push({ ...cells[selected], type });
    cells[selected] = cells.at(-1); cells.pop(); // Sample without replacement so every special peg gets its own cell.
  }
  return layout;
} // Shuffle blocks, bombs and coins across rows 1-19; keep all four entry pins clear for each new wager.

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

export function obstacleDrop(draw = randomInt, obstacles = randomObstacles(draw)) {
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
