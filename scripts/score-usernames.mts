// Scores every name in a file with our username filter: npx tsx scripts/score-usernames.mts [file]
import { readFileSync } from 'node:fs';
import { BLOCK_SCORE, REVIEW_SCORE, usernameScore } from '../src/moderation.ts';

const file = process.argv[2] ?? new URL('./username-samples.txt', import.meta.url);
for (const name of readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const { score, reason } = usernameScore(name);
  const verdict = score >= BLOCK_SCORE ? 'BLOCK' : score >= REVIEW_SCORE ? 'review' : 'ok';
  console.log(`${name}\t${score}\t${verdict}\t${reason ?? ''}`);
}
