// Quick check of the word filter: npx tsx scripts/test-moderation.mts
import { BLOCK_SCORE, REVIEW_SCORE, findBlocked, usernameScore } from '../src/moderation.ts';

const ok = ['Gasoline from raw oil', 'therapist grape torpedo raccoon', 'Large Assembler class', 'Scunthorpe spice Pakistan', 'flame retardant', 'Hitachi drape', 'Polyethylene loop', 'great build, thanks!', 'cocoon', 'Shitake', 'Cocktail', 'skyscraper', 'Monazite dust', 'plus lutetium', 'a bit chancy', 'Bastnasite', 'Cassiterite', 'Rapeseed oil'];
const bad = ['you are a n1gg3r', 'f.u.c.k this', 'FUUUUCK', 'kys loser', 'total retard', 'what an ass', 'b1tch', 'kkk', 'fag'];
const falsePos = ok.filter((t) => findBlocked(t)).map((t) => `${t} -> ${findBlocked(t)}`);
const missed = bad.filter((t) => !findBlocked(t));
console.log('false positives:', falsePos);
console.log('missed:', missed);
// Usernames: refused (>= BLOCK_SCORE), "not sure" (REVIEW_SCORE up to that; APIVerve when on) or fine.
// Expectations follow a judged sample (scripts/username-samples.txt, scored by a reviewer).
const verdict = (n: string) => { const s = usernameScore(n).score; return s >= BLOCK_SCORE ? 'block' : s >= REVIEW_SCORE ? 'review' : 'ok'; };
const expect: Record<string, string[]> = {
  block: ['niggr', 'reggin', 'kcuf_you', 'porn_star', 'buttplug_bob', 'dildo_baggins', 'f4gg0t_killer', 'fuckface99', 'admin', 'Аdmin', 'gregcalc', 'ѕhit_lord', 'nіgger', 'k_k_k', 'rapeface', 'cuntry_boy', 'balls_deep', 'pussy_slayer', 'heil_hitler88', 'Nonceyguy', 'jihadist99'],
  review: ['bigpenis42', 'SpunkGobbler', 'phuckit'],
  ok: ['steve_99', 'classy_builder', 'Assembler42', 'xdickensx', 'Scunthorpe_Steve', 'cocktail_carl', 'grapefruit', 'raccoon_rider', 'tycoon_tim', 'Pakistani_Pride', 'pussycat_dolls', 'Penistone_Pete', 'Shitterton', 'NegroniLover', 'queer_crafter', 'Killer_Queen', 'Trump_Fan', 'xXx_Slayer_xXx', 'BuggerOff', 'MotherTrucker', 'Torpedo_Tom', 'pedometer', 'sexyboy69', 'ligma_balls', 'deez_nuts', 'BadAss_Miner', 'Ore_Hunter_69'],
};
const wrong = Object.entries(expect).flatMap(([want, names]) => names.filter((n) => verdict(n) !== want).map((n) => `${n}: ${verdict(n)} (${usernameScore(n).score}, ${usernameScore(n).reason}), expected ${want}`));
console.log('username mismatches:', wrong);
process.exit(falsePos.length || missed.length || wrong.length ? 1 : 0);
