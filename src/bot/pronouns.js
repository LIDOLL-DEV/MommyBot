export function memberPronouns(member) {
  const names = new Set([...(member?.roles?.cache?.values?.() || [])].map(role =>
    String(role.name || "").normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, "")));
  const she = names.has("she/her"), he = names.has("he/him");
  if (names.has("it'scomplicated") || she === he) return "they/them";
  return she ? "she/her" : "he/him";
} // Use only the three designated roles; absent, conflicting or explicitly neutral roles never imply a gender.

export async function currentPronouns(guild, userId, member = null) {
  if (guild?.members?.fetch) {
    try { member = await guild.members.fetch({ user: userId, force: true }); }
    catch { return "they/them"; }
  }
  return memberPronouns(member);
} // Refresh roles for each generated reply, including saved notifications retried after a role change.

export function pronounInstruction(pronouns = "they/them") {
  if (pronouns === "she/her") return "This member uses she/her pronouns. Feminine or neutral endearments are appropriate; do not call this member a boy or use he/him.";
  if (pronouns === "he/him") return "This member uses he/him pronouns. Masculine or neutral endearments are appropriate; do not call this member a girl or use she/her.";
  return "This member uses they/them pronouns. Use gender-neutral endearments such as sweetheart or darling; do not call this member a girl, boy, woman or man, or use she/her or he/him.";
} // Only fixed application text reaches the model; role names and arbitrary Discord profile text are not instructions.

export function goodTerm(pronouns = "they/them") {
  return pronouns === "she/her" ? "good girl" : pronouns === "he/him" ? "good boy" : "good little one";
} // Praise uses the same three designated roles as every other address; an absent or conflicting role stays neutral.

export function mismatchedAddress(text, pronouns = "they/them") {
  const masculine = /\b(?:boys?|men|man|guys?|dudes?|sons?|sir|mister|mr|gentlem[ae]n|lads?|bros?|brothers?|prince|king|male|he|him|his|himself)\b/i;
  const feminine = /\b(?:girls?|women|woman|lad(?:y|ies)|daughter|sister|princess|queen|female|she|her|hers|herself)\b/i;
  return (pronouns !== "he/him" && masculine.test(text)) || (pronouns !== "she/her" && feminine.test(text));
} // Short member-directed notices fall back to neutral wording when generated address contradicts their role.
