/**
 * Saved-flow sync. Saves always land in browser storage first (instantly). Every write is
 * compared with the last one, and changed, new or deleted flows are queued; while logged in,
 * the queue is pushed to the server every 30 seconds (and when the tab is hidden).
 *
 * - Deletes are remembered in browser storage until the server confirms them, so a flow
 *   deleted while offline or logged out doesn't come back at the next login.
 * - Flows confirmed on the server are tracked per account, so logging out can clear exactly
 *   those from a shared computer (anything not yet uploaded stays put).
 */

export interface SyncFlow { id: string; name: string; savedAt: number; draft?: boolean; nodes: unknown[]; connections: unknown[]; targetEUtBudget: number }
/**
 * What a push did. `stored`: ids the server now holds (uploaded) or confirmed gone (deleted).
 * `retry`: ids that failed for a reason worth retrying (network trouble). Any other id was
 * refused (too big, or rejected by the rules) and lives only in this browser.
 */
export interface PushResult { stored: string[]; retry: string[] }
/** Uploads flows and deletes; throwing means nothing was confirmed (all are retried). */
export interface SyncAdapter { push: (flows: SyncFlow[], deleted: string[]) => Promise<PushResult> }

const SYNC_MS = 30_000;
const TOMBSTONES = 'gt_calc_flow_tombstones';
const changed = new Map<string, SyncFlow>();
const deleted = new Set<string>();
let seen = new Map<string, string>(); // id -> signature of the last written version
let adapter: SyncAdapter | null = null;
let account: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const signature = (f: SyncFlow) => `${f.savedAt}|${f.name}|${f.draft ? 1 : 0}`;
const readSet = (key: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set<string>(); } };
const writeSet = (key: string, set: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...set].slice(-2000))); } catch { /* storage full */ } };
const syncedKey = (uid: string) => `gt_calc_synced_${uid}`;

/** Flows deleted here that the server may still have (skip them when merging; delete them there). */
export function tombstones() { return readSet(TOMBSTONES); }

/** Call after every write of the saves list; queues whatever differs from the previous write. */
export function noteSaves(list: SyncFlow[]) {
  const next = new Map<string, string>();
  for (const f of list) {
    const sig = signature(f);
    next.set(f.id, sig);
    if (seen.get(f.id) !== sig) { changed.set(f.id, f); deleted.delete(f.id); }
  }
  const graves = tombstones();
  for (const id of seen.keys()) if (!next.has(id)) { deleted.add(id); changed.delete(id); graves.add(id); }
  writeSet(TOMBSTONES, graves);
  seen = next;
  if (adapter && (changed.size || deleted.size)) setStatus('pending');
}

/** Start from this list without queuing it (what's already in storage at page load). */
export function primeSaves(list: SyncFlow[]) {
  seen = new Map(list.map((f) => [f.id, signature(f)]));
}

/** Queue flows to upload regardless of what was seen (e.g. local flows the server lacks). */
export function queueFlows(list: SyncFlow[]) {
  for (const f of list) changed.set(f.id, f);
}
/** Queue server-side deletes (e.g. flows deleted here while logged out). */
export function queueDeletes(ids: Iterable<string>) {
  for (const id of ids) deleted.add(id);
}

/** Flows known to be on the server for this account (fetched or uploaded). */
export function markSynced(uid: string, ids: Iterable<string>) {
  const set = readSet(syncedKey(uid));
  for (const id of ids) set.add(id);
  writeSet(syncedKey(uid), set);
}
/** Flows whose latest version isn't on the server, so logout must keep them here. */
function unmarkSynced(uid: string, ids: string[]) {
  if (!ids.length) return;
  const set = readSet(syncedKey(uid));
  for (const id of ids) set.delete(id);
  writeSet(syncedKey(uid), set);
}
/** On logout: the account's server-backed flow ids (then forgotten), minus any not yet uploaded. */
export function takeSynced(uid: string) {
  const set = readSet(syncedKey(uid));
  for (const id of changed.keys()) set.delete(id);
  try { localStorage.removeItem(syncedKey(uid)); } catch { /* ignore */ }
  return set;
}

/** Plug in the server for an account (on login), or unplug it (null, on logout: the queue is dropped). */
export function setSyncAdapter(next: SyncAdapter | null, uid: string | null = null) {
  adapter = next;
  account = next ? uid : null;
  if (!next) { changed.clear(); deleted.clear(); }
  if (timer) clearInterval(timer);
  timer = next ? setInterval(() => void flushSync(), SYNC_MS) : null;
}

// Sync status for the header's cloud icon: 'pending' (saved here, not yet on the server),
// 'syncing' (a push is running) or 'idle' (all up to date).
export type SyncStatus = 'idle' | 'pending' | 'syncing';
let status: SyncStatus = 'idle';
const statusListeners = new Set<() => void>();
function setStatus(next: SyncStatus) { if (next !== status) { status = next; statusListeners.forEach((l) => l()); } }
export const getSyncStatus = () => status;
export function onSyncStatus(l: () => void) { statusListeners.add(l); return () => { statusListeners.delete(l); }; }

export async function flushSync() {
  if (!adapter || (!changed.size && !deleted.size)) return;
  setStatus('syncing');
  const flows = [...changed.values()];
  const gone = [...deleted];
  const uid = account;
  changed.clear();
  deleted.clear();
  let result: PushResult;
  try {
    result = await adapter.push(flows, gone);
  } catch {
    result = { stored: [], retry: [...flows.map((f) => f.id), ...gone] };
  }
  const again = new Set(result.retry);
  const stored = new Set(result.stored);
  // Retry later; newer versions queued meanwhile win.
  for (const f of flows) if (again.has(f.id) && !changed.has(f.id)) changed.set(f.id, f);
  for (const id of gone) if (again.has(id) && !seen.has(id)) deleted.add(id);
  // Only flows the server confirmed are safe to clear at logout; a refused or pending version
  // (even of a flow synced before) keeps the local copy.
  if (uid) {
    markSynced(uid, flows.filter((f) => stored.has(f.id)).map((f) => f.id));
    unmarkSynced(uid, flows.filter((f) => !stored.has(f.id)).map((f) => f.id));
  }
  const graves = tombstones();
  for (const id of gone) if (stored.has(id)) graves.delete(id); // confirmed gone on the server
  writeSet(TOMBSTONES, graves);
  setTimeout(() => setStatus(changed.size || deleted.size ? 'pending' : 'idle'), 600); // let the animation be seen
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushSync(); });
}
