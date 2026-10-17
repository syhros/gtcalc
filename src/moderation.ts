/**
 * Blocks slurs, hate terms and severe profanity in usernames, comments and build names or
 * descriptions. The text is normalised first (lower case, look-alike characters such as
 * 0/1/3/4/5/7/@/$ mapped back to letters, repeated letters collapsed) so "n1gg3r" or
 * "fuuuck" are caught too. Short words are matched as whole words so ordinary words
 * ("class", "Assembler", "Scunthorpe") pass.
 *
 * The same core list is enforced server-side in firestore.rules (keep the two in step), so
 * this check can't be skipped by writing to the database directly. Usernames are also scored
 * against a longer list (moderationWords.ts, from decent-username); see usernameScore.
 */
import { HOMOGLYPHS, RESERVED, USERNAME_MILD, USERNAME_STRONG } from './moderationWords';

// Matched anywhere in the normalised text (no common English word contains these).
const ANYWHERE = [
  'nigger', 'nigga', 'faggot', 'kike', 'wetback', 'tranny', 'raghead', 'towelhead', 'beaner',
  'motherfuck', 'fuck', 'bullshit', 'shithead', 'shitty', 'whore', 'slut', 'bitch', 'hitler', 'killyourself',
  'paedo', 'pedophil', 'molest',
];
// Only as whole words (they appear inside harmless words otherwise: therapist, grape, torpedo,
// raccoon, spice, Pakistan, class, Assembler, Scunthorpe, flame retardant).
const WHOLE_WORD = [
  'nazi', 'nazis', 'shit', 'retard', 'retarded', 'chink', 'spic', 'coon', 'gook', 'paki', 'dyke', 'cunt', 'rape', 'rapist', 'pedo', 'kys',
  'ass', 'arse', 'fag', 'cum', 'dick', 'cock', 'twat', 'wank', 'jizz', 'porn', 'sex', 'anal', 'tits',
];

const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g' };

function normalise(text: string) {
  return [...text.toLowerCase()].map((c) => HOMOGLYPHS[c] ?? c).join('') // Cyrillic а, Greek ο...
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[0-9!|@$+]/g, (c) => LOOKALIKE[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1'); // "fuuuuck" -> "fuuck"
}

/** The first blocked word found, or null if the text is fine. */
export function findBlocked(text: string): string | null {
  if (/k[\W_]*k[\W_]*k/i.test(text)) return 'kkk';
  const n = normalise(text);
  // Within each word only ("f.u.c.k", "fuuck" -> "fuck"), so "plus lutetium" or "a bit chancy"
  // don't run together into something they aren't.
  const squashedWords = n.split(/\s+/).map((w) => w.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1'));
  for (const w of ANYWHERE) {
    const single = w.replace(/(.)\1+/g, '$1');
    // The squashed form ("f.u.c.k" -> "fuck") only for words long enough to stay distinctive.
    if (n.includes(w) || (single.length >= 4 && squashedWords.some((x) => x.includes(single)))) return w;
  }
  const words = n.split(/[^a-z]+/);
  for (const w of WHOLE_WORD) if (words.includes(w)) return w;
  return null;
}

/** Edit distance up to 1 (one letter added, removed or changed). */
function withinOne(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Username scores, 0 to 1. At or above BLOCK_SCORE a name is refused; from REVIEW_SCORE up to
 * that it counts as "not sure", which APIVerve can settle when it's switched on (see
 * checkUsername in community.ts). Thresholds were set from a judged test list
 * (scripts/test-moderation.mts).
 */
export const BLOCK_SCORE = 0.85;
export const REVIEW_SCORE = 0.5;

const STRONG = USERNAME_STRONG.map(normaliseWord);
const MILD = USERNAME_MILD.map(normaliseWord);
const RESERVED_SET = new Set(RESERVED.map((w) => normalise(w).replace(/[^a-z]/g, '')));
function normaliseWord(w: string) { return normalise(w).replace(/[^a-z]/g, ''); }

/**
 * Ordinary words and names that happen to contain a listed word (the "Scunthorpe problem").
 * They're cut out of a username before looking for hidden words, so "cocktail_carl" or
 * "grapefruit" score 0 while "xcockx" still counts.
 */
const SAFE = [
  'cocktail', 'peacock', 'hancock', 'hitchcock', 'woodcock', 'shuttlecock', 'cockpit', 'cockatoo', 'cockatiel', 'cockroach', 'babcock', 'alcock',
  'scunthorpe', 'therapist', 'grape', 'drape', 'scrape', 'trapeze', 'dickens', 'dickinson', 'benedict', 'analys', 'analog', 'canal', 'banal',
  'arsenal', 'arsenic', 'spice', 'spicy', 'despicable', 'raccoon', 'cocoon', 'tycoon', 'coonhound', 'pakistan', 'shitake', 'shiitake',
  'cumulus', 'cumber', 'cucumber', 'circum', 'document', 'accumul', 'assassin', 'bass', 'class', 'assembl', 'assist', 'grass', 'brass', 'glass',
  'mass', 'pass', 'compass', 'embass', 'sextant', 'sextet', 'sussex', 'essex', 'middlesex', 'penistone', 'clitheroe', 'shitterton', 'pussycat',
  'pussywillow', 'negroni', 'prickly', 'wankie', 'titan', 'titanium', 'constitut', 'competit', 'petit', 'butter', 'button', 'buttress',
  'scrap', 'skyscraper', 'hello', 'shell', 'michelle', 'shoe', 'snigger', 'niger', 'nigeria', 'kumquat', 'documen', 'homolog', 'homogen',
  'cockburn', 'twatt', 'uranus', 'cumbia', 'spunky', 'nonchalant', 'sconce', 'ponce', 'torpedo', 'pedometer', 'stampede', 'impede', 'expedi',
];
const SAFE_RE = new RegExp(SAFE.join('|'), 'g');
/** Words bad enough to refuse even run into other letters ("Nonceyguy"), where few innocent words hide them. */
const SEVERE = ['nonce', 'jihad', 'rapist', 'molest', 'pedo', 'paedo'];

/**
 * How likely a username is to be offensive, from our own lists (no network), with the reason:
 *  1    a core blocked word (as findBlocked) or a reserved name (admin, moderator...)
 *  0.95 a word from the longer list as its own word ("pussy_slayer")
 *  0.9  a near miss of a slur or strong word (one letter off), or one spelled backwards; a
 *       6+ letter word from the longer list run into others ("ballsackbill")
 *  0.85 a core short-list word (4+ letters) hidden inside a bigger word ("xdickensx")
 *  0.75 / 0.65  a 5 / 4 letter word from the longer list inside a bigger word ("pussycat")
 *  0.55 / 0.45  a mild word (bugger, pissed, tosser, ligma...) on its own / run into others: allowed
 *  0.4  a short core word inside a bigger word ("sexyboy", "BadAss"), or 69: fine
 *  0.9  also: a SEVERE word anywhere in a word ("Nonceyguy")
 * Hidden words are only looked for outside ordinary words that contain them (SAFE).
 *  0    nothing suspicious
 */
export function usernameScore(name: string): { score: number; reason: string | null } {
  const core = findBlocked(name);
  if (core) return { score: 1, reason: core };
  const n = normalise(name);
  const joined = n.replace(/[^a-z]/g, '');
  if (RESERVED_SET.has(joined)) return { score: 1, reason: `reserved: ${joined}` };
  const parts = n.split(/[^a-z]+/).filter(Boolean);
  const reversed = [...joined].reverse().join('');
  // Where hidden words are looked for: each word on its own ("Pen_Island" isn't "penisland"),
  // with ordinary words that contain a listed one cut out.
  const hidden = parts.map((p) => p.replace(SAFE_RE, '-')).join('-');
  // Whole words, plus runs of up to three neighbours ("balls_deep" -> "ballsdeep").
  const own = new Set(parts.flatMap((_, i) => [1, 2, 3].map((k) => parts.slice(i, i + k).join(''))));
  let best = { score: 0, reason: null as string | null };
  const hit = (score: number, reason: string) => { if (score > best.score) best = { score, reason }; };
  for (const w of STRONG) {
    if (own.has(w)) hit(0.95, w);
    else if (hidden.includes(w)) hit(w.length >= 6 ? 0.9 : w.length === 5 ? 0.75 : 0.65, w);
  }
  for (const w of ANYWHERE) {
    if (w.length >= 4 && (reversed.includes(w) || parts.some((p) => p.length >= 4 && withinOne(p, w)))) hit(0.9, `near ${w}`);
  }
  for (const w of SEVERE) if (hidden.includes(w)) hit(0.9, `severe: ${w}`);
  for (const w of WHOLE_WORD) if (hidden.includes(w)) hit(w.length >= 4 ? 0.85 : 0.4, `inside: ${w}`);
  if (/(^|[^0-9])69([^0-9]|$)/.test(name)) hit(0.4, '69');
  for (const w of MILD) {
    if (own.has(w)) hit(0.55, w);
    else if (w.length >= 5 && hidden.includes(w)) hit(0.45, w);
  }
  return best;
}

/** Throws a readable error when the text contains a blocked word. */
export function assertClean(text: string, what: string) {
  if (findBlocked(text)) throw new Error(`That ${what} contains a word that isn't allowed here`);
}

/** Throws a readable error for a username that scores BLOCK_SCORE or more. */
export function assertCleanUsername(name: string) {
  const { score, reason } = usernameScore(name);
  if (score < BLOCK_SCORE) return;
  throw new Error(reason?.startsWith('reserved') ? 'That username is reserved' : 'That username contains a word that isn\'t allowed here');
}

/**
 * A shared flow's name or description, scored like a username but word by word (so "class
 * assignment" isn't read as one run of letters), plus the core list over the whole text.
 * Reserved names (admin...) are fine in text.
 */
export function textScore(text: string): { score: number; reason: string | null } {
  const core = findBlocked(text);
  if (core) return { score: 1, reason: core };
  let best = { score: 0, reason: null as string | null };
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  // Single words, and pairs (so "balls deep" counts like "balls_deep").
  const pieces = [...words, ...words.slice(1).map((w, i) => `${words[i]}_${w}`)];
  for (const w of pieces) {
    const r = usernameScore(w);
    if (r.score > best.score && !r.reason?.startsWith('reserved')) best = r;
  }
  return best;
}

/** Throws a readable error for shared text that scores BLOCK_SCORE or more. */
export function assertCleanText(text: string, what: string) {
  if (textScore(text).score >= BLOCK_SCORE) throw new Error(`That ${what} contains a word that isn't allowed here`);
}
