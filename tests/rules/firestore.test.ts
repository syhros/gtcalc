// Firestore rules tests. Run with `npm run test:rules` (starts the Firestore emulator; needs
// firebase-tools and Java 11+). Each hole found in the 2026-10-18 review has a test that a
// write the attack needs is refused, next to the normal write the app makes.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayUnion, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';

let env: RulesTestEnvironment;
const FP = 'a'.repeat(24);
const FP2 = 'b'.repeat(24);
const BUILD = `alice_${FP}`;
const stats = { machines: 2, topTier: 'LV', lowTier: 'ULV', eutUse: 30, eutGen: 0, output: { id: 'iron_dust', name: 'Iron Dust' } };

const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gtcalc',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8181 },
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  // Alice has an account, one shared build and its fingerprint claim, with one comment on it.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'usernames', 'alice'), { uid: 'alice', username: 'Alice', hasEmail: true });
    await setDoc(doc(db, 'users', 'alice'), { username: 'Alice', createdAt: new Date() });
    await setDoc(doc(db, 'usernames', 'bob'), { uid: 'bob', username: 'Bob', hasEmail: true });
    await setDoc(doc(db, 'users', 'bob'), { username: 'Bob', createdAt: new Date() });
    await setDoc(doc(db, 'limits', 'alice'), { lastBuild: new Date(0), lastBuildId: BUILD });
    await setDoc(doc(db, 'builds', BUILD), {
      name: 'Iron', description: '', author: 'Alice', authorId: 'alice', pack: 'gtnh', createdAt: new Date(),
      flowJson: '{}', stats, upvoters: [], favoriters: [], commentCount: 1,
    });
    await setDoc(doc(db, 'fingerprints', FP), { uid: 'alice', buildId: BUILD });
    await setDoc(doc(db, 'builds', BUILD, 'comments', 'c1'), { author: 'Bob', authorId: 'bob', text: 'nice', createdAt: new Date(), up: [], down: [] });
  });
});

describe('username claims', () => {
  it('signing up claims the name and creates the profile together', async () => {
    const db = as('carol');
    const b = writeBatch(db);
    b.set(doc(db, 'usernames', 'carol'), { uid: 'carol', username: 'Carol', hasEmail: true });
    b.set(doc(db, 'users', 'carol'), { username: 'Carol', createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });

  it('an account without a profile cannot claim names on their own', async () => {
    const db = as('carol');
    await assertFails(setDoc(doc(db, 'usernames', 'squat1'), { uid: 'carol', username: 'squat1', hasEmail: true }));
  });

  it('a flagged account renames: old claim out, new claim in, profile renamed', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'renameFlags', 'bob'), { by: 'mod', at: new Date() });
    });
    const db = as('bob');
    const b = writeBatch(db);
    b.delete(doc(db, 'usernames', 'bob'));
    b.set(doc(db, 'usernames', 'robert'), { uid: 'bob', username: 'Robert', hasEmail: true });
    b.update(doc(db, 'users', 'bob'), { username: 'Robert' });
    b.delete(doc(db, 'renameFlags', 'bob'));
    await assertSucceeds(b.commit());
  });

  it('a profile cannot be deleted while its username claim stays', async () => {
    await assertFails(deleteDoc(doc(as('bob'), 'users', 'bob')));
  });
});

describe('rate-limit stamps', () => {
  it('cannot be deleted while the account still exists', async () => {
    await assertFails(deleteDoc(doc(as('alice'), 'limits', 'alice')));
  });

  it('go with the account when it is deleted', async () => {
    const db = as('alice');
    const b = writeBatch(db);
    b.delete(doc(db, 'users', 'alice'));
    b.delete(doc(db, 'usernames', 'alice'));
    b.delete(doc(db, 'renameFlags', 'alice'));
    await assertSucceeds(b.commit());
    await assertSucceeds(deleteDoc(doc(db, 'limits', 'alice')));
  });
});

describe('comment votes', () => {
  it('a normal up vote is allowed', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'builds', BUILD, 'comments', 'c1'), { up: arrayUnion('alice') }));
  });

  it('the same uid cannot be added twice', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'builds', BUILD, 'comments', 'c1'), { up: ['alice', 'alice', 'alice'] }));
  });
});

describe('fingerprint claims', () => {
  it('a claim must be a 24-digit hex fingerprint', async () => {
    await assertFails(setDoc(doc(as('alice'), 'fingerprints', 'not-a-fingerprint'), { uid: 'alice', buildId: BUILD }));
  });

  it('a claim for an existing build needs that build updated to it in the same write', async () => {
    await assertFails(setDoc(doc(as('alice'), 'fingerprints', FP2), { uid: 'alice', buildId: BUILD }));
  });
});

describe('sharing a flow', () => {
  it('the build, its fingerprint claim and the rate-limit stamp go together', async () => {
    const db = as('bob');
    const id = `bob_${FP2}`;
    const b = writeBatch(db);
    b.set(doc(db, 'builds', id), {
      name: 'Steel', description: '', author: 'Bob', authorId: 'bob', pack: 'gtnh', createdAt: serverTimestamp(),
      flowJson: '{}', stats, upvoters: [], favoriters: [], commentCount: 0,
    });
    b.set(doc(db, 'fingerprints', FP2), { uid: 'bob', buildId: id });
    b.set(doc(db, 'limits', 'bob'), { lastBuild: serverTimestamp(), lastBuildId: id }, { merge: true });
    await assertSucceeds(b.commit());
  });
});

describe('updating a shared flow', () => {
  const update = (db: Firestore, extra: Record<string, unknown>) => {
    const b = writeBatch(db);
    b.update(doc(db, 'builds', BUILD), { flowJson: '{"nodes":[]}', stats, updatedAt: serverTimestamp(), ...extra });
    return b;
  };

  it('the author updates the flow and claims its new fingerprint', async () => {
    const db = as('alice');
    const b = update(db, { fp: FP2 });
    b.set(doc(db, 'fingerprints', FP2), { uid: 'alice', buildId: BUILD });
    await assertSucceeds(b.commit());
  });

  it('updating back to a fingerprint the build already holds needs no new claim', async () => {
    await assertSucceeds(update(as('alice'), { fp: FP }).commit());
  });

  it('an update must claim its fingerprint', async () => {
    await assertFails(update(as('alice'), {}).commit());
    await assertFails(update(as('alice'), { fp: FP2 }).commit());
  });

  it('an update cannot take a fingerprint claimed by another build', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'fingerprints', FP2), { uid: 'bob', buildId: `bob_${FP2}` });
    });
    await assertFails(update(as('alice'), { fp: FP2 }).commit());
  });

  it('an update checks the output stats like a new share does', async () => {
    const db = as('alice');
    const b = update(db, { fp: FP2, stats: { ...stats, output: { id: 7, name: ['x'] } } });
    b.set(doc(db, 'fingerprints', FP2), { uid: 'alice', buildId: BUILD });
    await assertFails(b.commit());
  });

  it('nobody else can update it', async () => {
    const db = as('bob');
    const b = update(db, { fp: FP2 });
    await assertFails(b.commit());
  });
});
