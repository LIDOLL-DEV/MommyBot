// Fixed collision course for synthetic tests; live games generate a new layout per wager.
export const OBSTACLES = Object.freeze([
  [3, 1, "bomb"], [3, 6, "block"], [4, 4, "block"], [4, 9, "bomb"],
  [6, 3, "bomb"], [6, 7, "block"], [7, 1, "block"], [7, 5, "bomb"],
  [8, 9, "block"], [9, 4, "block"], [10, 2, "bomb"], [10, 7, "bomb"],
  [12, 3, "block"], [12, 6, "block"], [13, 9, "bomb"], [14, 1, "block"],
  [14, 5, "bomb"], [15, 8, "block"], [16, 3, "bomb"], [17, 6, "block"],
  [1, 3, "coin"], [2, 7, "coin"], [5, 2, "coin"], [8, 6, "coin"],
  [11, 8, "coin"], [15, 4, "coin"], [18, 2, "coin"], [18, 9, "coin"],
].map(([row, column, type]) => Object.freeze({ row, column, type })));
