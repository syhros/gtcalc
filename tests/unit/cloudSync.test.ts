// Logging out removes the flows that are safe on the server (takeSynced). A flow the server never
// stored must not be on that list, or logout deletes the only copy.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Sync = typeof import('../../src/cloudSync');
let sync: Sync;
const flow = (id: string, savedAt = 1) => ({ id, name: id, savedAt, nodes: [], connections: [], targetEUtBudget: 1 });

beforeEach(async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.resetModules();
  sync = await import('../../src/cloudSync');
  sync.primeSaves([]);
});

describe('flushSync and logout', () => {
  it('a flow the server stored is cleared at logout', async () => {
    sync.setSyncAdapter({ push: async (flows) => ({ stored: flows.map((f) => f.id), retry: [] }) }, 'u1');
    sync.noteSaves([flow('a')]);
    await sync.flushSync();
    expect([...sync.takeSynced('u1')]).toEqual(['a']);
  });

  it('a flow the server refused (too big, permission denied) stays in this browser', async () => {
    sync.setSyncAdapter({ push: async () => ({ stored: [], retry: [] }) }, 'u1');
    sync.noteSaves([flow('big')]);
    await sync.flushSync();
    expect(sync.takeSynced('u1').has('big')).toBe(false);
  });

  it('a synced flow whose newer version is refused stays in this browser', async () => {
    let accept = true;
    sync.setSyncAdapter({ push: async (flows) => ({ stored: accept ? flows.map((f) => f.id) : [], retry: [] }) }, 'u1');
    sync.noteSaves([flow('a', 1)]);
    await sync.flushSync();
    accept = false;
    sync.noteSaves([flow('a', 2)]);
    await sync.flushSync();
    expect(sync.takeSynced('u1').has('a')).toBe(false);
  });

  it('a flow waiting to retry stays in this browser and is pushed again', async () => {
    const pushed: string[][] = [];
    sync.setSyncAdapter({ push: async (flows) => { pushed.push(flows.map((f) => f.id)); return { stored: [], retry: flows.map((f) => f.id) }; } }, 'u1');
    sync.noteSaves([flow('a')]);
    await sync.flushSync();
    await sync.flushSync();
    expect(pushed).toEqual([['a'], ['a']]);
    expect(sync.takeSynced('u1').has('a')).toBe(false);
  });

  it('an adapter that throws retries everything', async () => {
    let calls = 0;
    sync.setSyncAdapter({ push: async () => { calls++; throw new Error('offline'); } }, 'u1');
    sync.noteSaves([flow('a')]);
    await sync.flushSync();
    await sync.flushSync();
    expect(calls).toBe(2);
    expect(sync.takeSynced('u1').has('a')).toBe(false);
  });

  it('a delete clears its tombstone only once the server confirms it', async () => {
    let confirm = false;
    sync.setSyncAdapter({ push: async (_flows, gone) => ({ stored: confirm ? gone : [], retry: [] }) }, 'u1');
    sync.primeSaves([flow('a')]);
    sync.noteSaves([]);
    await sync.flushSync();
    expect(sync.tombstones().has('a')).toBe(true);
    confirm = true;
    sync.queueDeletes(['a']);
    await sync.flushSync();
    expect(sync.tombstones().has('a')).toBe(false);
  });
});
