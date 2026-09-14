export const WORDS = [
  ["BUNNY", "A fluffy friend with long ears"], ["APPLE", "A crunchy fruit that grows on a tree"],
  ["KITTEN", "A baby cat"], ["PUPPY", "A baby dog"], ["TEDDY", "A cuddly toy bear"],
  ["CLOUD", "A fluffy shape in the sky"], ["COOKIE", "A little baked treat"],
  ["FLOWER", "A colorful blossom in the garden"], ["RAINBOW", "Colors across the sky after rain"],
  ["STAR", "A tiny light in the night sky"], ["MOON", "Our bright neighbor in the night sky"],
  ["SUNSHINE", "Warm light on a lovely day"], ["BLANKET", "Something soft to snuggle under"],
  ["PILLOW", "A soft place to rest your head"], ["RIBBON", "A pretty strip tied into a bow"],
  ["BUBBLE", "A round, floating bit of soapy fun"], ["BALLOON", "A party decoration filled with air"],
  ["BUTTERFLY", "A garden visitor with colorful wings"], ["LADYBUG", "A little red beetle with spots"],
  ["DUCK", "A bird that says quack"], ["PANDA", "A black-and-white bear that loves bamboo"],
  ["KOALA", "A furry tree-dwelling friend from Australia"], ["OTTER", "A playful swimmer with whiskers"],
  ["FROG", "A little jumper that says ribbit"], ["TURTLE", "A slow friend with a shell"],
  ["PONY", "A small horse"], ["LAMB", "A baby sheep"], ["CHICK", "A baby chicken"],
  ["PEACH", "A soft, fuzzy fruit"], ["BANANA", "A yellow fruit you peel"],
  ["CHERRY", "A small red fruit with a stem"], ["BERRY", "A little fruit that can grow on a bush"],
  ["MELON", "A big juicy fruit with a rind"], ["CARROT", "An orange vegetable a bunny might nibble"],
  ["HONEY", "A sweet treat made by bees"], ["MUFFIN", "A little cake, often with blueberries"],
  ["CUPCAKE", "A tiny cake with frosting"], ["WAFFLE", "A breakfast treat with little square pockets"],
  ["PANCAKE", "A round breakfast treat cooked in a pan"], ["COCOA", "A warm chocolate drink"],
  ["MITTEN", "A cozy cover for your hand"], ["SOCKS", "Soft things you put on before your shoes"],
  ["SLIPPERS", "Cozy shoes for inside the house"], ["POCKET", "A little place in your clothes for treasures"],
  ["CRAYON", "A colorful stick for drawing"], ["PUZZLE", "A picture you put together piece by piece"],
  ["BOOK", "Something full of pages and stories"], ["MUSIC", "Sounds you can sing and dance to"],
  ["GARDEN", "A place to grow flowers and vegetables"], ["PICNIC", "A meal enjoyed outdoors"],
  ["CASTLE", "A grand home with towers"], ["CROWN", "A royal decoration worn on the head"],
  ["SHELL", "A little treasure you might find on the beach"], ["SNOW", "Soft white flakes from the sky"],
  ["LEAF", "A green part of a tree"], ["ACORN", "A little nut with a cap"],
  ["SPARKLE", "A tiny flash of glittery light"], ["HEART", "A shape that can mean love"],
  ["SMILE", "A happy curve on your face"], ["HUG", "A friendly cuddle"],
].map(([word, clue]) => ({ word, clue })); // Keep a small, reviewed set of friendly words and useful clues on the server only.

export function hangmanConfig(env = process.env) {
  if (env.HANGMAN_ENABLED === "true" && (env.LIDOLLID_ENABLED !== "true" || env.LIDOLLCOIN_ENABLED !== "true")) {
    throw new Error("Hangman requires LiD0llID and online LiDollcoins.");
  }
  return { enabled: env.HANGMAN_ENABLED !== "false", price: 1, maxMistakes: 6 };
} // One coin starts a round; disabling new rounds preserves existing games and payment recovery.
