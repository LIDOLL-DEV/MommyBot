export class GoFishError extends Error {}

export const RANKS = "A23456789TJQK", SUITS = "SHDC", HAND_SIZE = 7, BOOKS = 13, LOG_KEPT = 24;
export const RANK_NAMES = { A: "Aces", 2: "Twos", 3: "Threes", 4: "Fours", 5: "Fives", 6: "Sixes", 7: "Sevens",
  8: "Eights", 9: "Nines", T: "Tens", J: "Jacks", Q: "Queens", K: "Kings" };
export const rankName = rank => RANK_NAMES[rank] || "cards";
export const other = seat => seat === "host" ? "guest" : "host";

export function goFishConfig(env = process.env) {
  if (env.GOFISH_ENABLED === "true" && (env.LIDOLLID_ENABLED !== "true" || env.LIDOLLCOIN_ENABLED !== "true")) {
    throw new Error("Go Fish requires LiD0llID and online LiDollcoins.");
  }
  return { enabled: env.GOFISH_ENABLED !== "false", price: 1, rewardPerBook: 1, waitMinutes: 30, challengeMinutes: 10 };
} // One coin starts a game against the computer; friend games are free and never reach the wallet.

export function freshDeck(draw) {
  const deck = [...SUITS].flatMap(suit => [...RANKS].map(rank => rank + suit));
  for (let i = deck.length - 1; i > 0; i--) { const j = draw(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
} // Shuffle with the injected server randomness so no browser or opponent can predict the pond.

export function collect(state, seat) {
  const gained = [];
  for (const rank of RANKS) {
    if (state.hands[seat].filter(card => card[0] === rank).length !== 4) continue;
    state.hands[seat] = state.hands[seat].filter(card => card[0] !== rank);
    state.books[seat] += rank; gained.push(rank);
  }
  return gained;
} // A fourth matching card is laid down at once, so a completed rank can never be asked for again.

export function restock(state, seat) {
  const gained = [];
  for (let guard = 0; guard <= BOOKS; guard++) {
    gained.push(...collect(state, seat));
    if (state.hands[seat].length || !state.deck.length) break;
    state.hands[seat].push(state.deck.shift());
  }
  return gained;
} // An emptied hand draws back from the pond, repeating when that card completes another book.

export const stuck = state => !state.deck.length && (!state.hands.host.length || !state.hands.guest.length);
export const over = state => state.books.host.length + state.books.guest.length >= BOOKS || stuck(state);
export function winner(state) {
  const host = state.books.host.length, guest = state.books.guest.length;
  return host === guest ? "tie" : host > guest ? "host" : "guest";
}

export function deal(draw) {
  const deck = freshDeck(draw);
  const state = { deck, hands: { host: deck.splice(0, HAND_SIZE), guest: deck.splice(0, HAND_SIZE) },
    books: { host: "", guest: "" }, turn: "host", log: [] };
  for (const seat of ["host", "guest"]) restock(state, seat);
  return state;
} // Four of a kind dealt into an opening hand is laid down immediately; only asked-for books pay coins.

export function play(state, seat, rank) {
  if (typeof rank !== "string" || !RANKS.includes(rank) || rank.length !== 1) throw new GoFishError("Choose one of the ranks in your hand.");
  if (!state.hands[seat].some(card => card[0] === rank)) throw new GoFishError("You can only ask for a rank you are holding.");
  const foe = other(seat), taken = state.hands[foe].filter(card => card[0] === rank);
  const event = { by: seat, rank, got: taken.length, fished: false, wish: false, books: [] };
  if (taken.length) {
    state.hands[foe] = state.hands[foe].filter(card => card[0] !== rank);
    state.hands[seat].push(...taken);
  } else {
    event.fished = true;
    const card = state.deck.shift();
    if (card) { state.hands[seat].push(card); event.wish = card[0] === rank; }
  }
  event.books = restock(state, seat);
  restock(state, foe); // A forced draw keeps the opponent holding cards while the pond lasts.
  state.log = [...state.log, event].slice(-LOG_KEPT);
  state.turn = over(state) ? state.turn : event.got || event.wish ? seat : foe;
  return event;
} // Taking cards or fishing your own wish earns another ask; the drawn card itself is never revealed.

export function computerAsk(state, draw) {
  const counts = new Map();
  for (const card of state.hands.guest) counts.set(card[0], (counts.get(card[0]) ?? 0) + 1);
  const held = new Map();
  for (const event of state.log) {
    if (event.by === "host") held.set(event.rank, !event.books.includes(event.rank)); // Asking proves the rank was in hand unless it was just booked.
    else if (event.got) held.set(event.rank, false); // Taking every copy clears what that ask revealed.
  }
  const ranks = [...counts.keys()], likely = ranks.filter(rank => held.get(rank));
  const pool = likely.length ? likely : ranks, best = Math.max(...pool.map(rank => counts.get(rank)));
  const choices = pool.filter(rank => counts.get(rank) === best);
  return choices[draw(choices.length)];
} // The computer plays only on what the shared log revealed, never by reading the player's hand or the pond.

export function describe(event, seat) {
  const mine = event.by === seat, who = mine ? "You" : "They", name = rankName(event.rank);
  if (event.got) return `${who} asked for ${name} and took ${event.got}.`;
  const fished = `${who} asked for ${name} — go fish!`;
  if (!event.fished) return fished;
  return event.wish ? `${fished} ${mine ? "You" : "They"} fished the wish and went again.` : fished;
} // Both players share one log, so it reports counts and wishes without naming a single drawn card.
