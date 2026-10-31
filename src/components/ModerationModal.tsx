import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { REPORT_REASONS, allowFlow, flowLink, allowUsername, deleteBuild, denyUsername, dismissCommentReports, dismissReports, loadCommentReports, loadFlowModeration, removeComment, type CommentReport, loadModeration, unbanName, listPackSuggestions, removePackSuggestion, type PackSuggestion, type FlowEntry, type FlowReport, type NameEntry, type Review } from '../community';
import { BLOCK_SCORE, REVIEW_SCORE } from '../moderation';

type Tab = 'review' | 'waiting' | 'decided' | 'banned' | 'all';

/**
 * Moderators: usernames scoring REVIEW_SCORE or more that nobody has decided on yet. Allow keeps
 * the name; Deny adds it to the denied names (nobody can claim it again) and makes its owner
 * pick a new one at their next login. Also lists past decisions and the denied names.
 */
export function ModerationModal({ onClose, onError }: { onClose: () => void; onError: (m: string) => void }) {
  const [section, setSection] = useState<'names' | 'flows' | 'packs'>('flows');
  const [data, setData] = useState<Awaited<ReturnType<typeof loadModeration>> | null>(null);
  const [tab, setTab] = useState<Tab>('review');
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const reload = useCallback(() => { loadModeration().then(setData).catch((e: Error) => onError(e.message)); }, [onError]);
  useEffect(reload, [reload]);

  const reviews = useMemo(() => new Map((data?.reviews ?? []).map((r) => [r.uid, r])), [data]);
  // Decided only while the name is still the one that was reviewed (a rename is reviewed afresh).
  const decided = (n: NameEntry) => reviews.get(n.uid)?.username === n.username;
  const toReview = (data?.names ?? []).filter((n) => n.score >= REVIEW_SCORE && !decided(n) && !n.flagged).sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  const waiting = (data?.names ?? []).filter((n) => n.flagged);
  const past = [...(data?.reviews ?? [])].sort((a, b) => b.at - a.at);
  const all = (data?.names ?? []).filter((n) => !q || n.username.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.createdAt - a.createdAt);

  const act = (n: NameEntry, fn: (n: NameEntry) => Promise<void>) => {
    setBusy(n.uid);
    fn(n).then(reload).catch((e: Error) => onError(e.message)).finally(() => setBusy(null));
  };
  const when = (ms: number) => (ms ? new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const scoreChip = (s: number) => (
    <span className={`px-1.5 py-0.5 border text-[10px] font-bold ${s >= BLOCK_SCORE ? 'border-rose-500/60 text-rose-300' : s >= REVIEW_SCORE ? 'border-amber-500/60 text-amber-300' : 'border-[#2b3548] text-slate-400'}`}>{s.toFixed(2)}</span>
  );
  const row = (n: NameEntry, actions = true) => (
    <div key={n.uid} className="flex items-center gap-2 p-2 border border-[#222a3b] bg-[#12151e]">
      <div className="min-w-0 flex-1">
        <div className="font-bold text-slate-100 break-all">{n.username}</div>
        <div className="text-[10px] text-slate-500">{n.reason ? `matched: ${n.reason}` : 'no match'} · joined {when(n.createdAt)}{reviews.get(n.uid) ? ` · last decision: ${reviews.get(n.uid)!.decision} (${reviews.get(n.uid)!.username})` : ''}</div>
      </div>
      {scoreChip(n.score)}
      {actions && (
        <>
          <button disabled={busy === n.uid} onClick={() => act(n, allowUsername)} className="px-2 py-0.5 border border-emerald-600/60 text-emerald-300 hover:bg-emerald-950 font-bold disabled:opacity-40">Allow</button>
          <button disabled={busy === n.uid} onClick={() => act(n, denyUsername)} className="px-2 py-0.5 border border-rose-600/60 text-rose-300 hover:bg-rose-950 font-bold disabled:opacity-40" data-tip="Deny: nobody can take this name again, and its owner picks a new one at next login">Deny</button>
        </>
      )}
    </div>
  );
  const tabs: [Tab, string][] = [
    ['review', `To review (${toReview.length})`], ['waiting', `Waiting for a new name (${waiting.length})`],
    ['decided', `Decisions (${past.length})`], ['banned', `Denied names (${data?.banned.length ?? 0})`], ['all', 'All users'],
  ];
  const empty = (t: string) => <div className="p-6 border border-[#222a3b] text-center text-slate-500 italic">{t}</div>;

  return (
    // Desktop: pinned 15% from the top at 70% of the height, so it doesn't jump between tabs.
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center md:items-start justify-center p-4 md:pt-[15vh]" onMouseDown={onClose}>
      <div className="w-[640px] max-w-full max-h-[88vh] md:h-[70vh] md:max-h-none flex flex-col bg-[#161a24] border border-[#2b3548] shadow-2xl text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-3 border-b border-[#283244]">
          <div className="text-sm font-bold text-slate-100">Moderation</div>
          <div className="flex border border-[#2b3548]">
            {([['flows', 'Shared flows'], ['names', 'Usernames'], ['packs', 'Pack requests']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setSection(k)} className={`px-2.5 py-0.5 font-bold whitespace-nowrap ${section === k ? 'bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>
            ))}
          </div>
          <span className="flex-1" />
          {section === 'names' && <button onClick={reload} className="px-2 py-0.5 border border-[#2b3548] text-slate-300 hover:bg-[#202737]">Refresh</button>}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" data-tip="Close" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {section === 'flows' ? <FlowModeration onError={onError} /> : section === 'packs' ? <PackRequests onError={onError} /> : (<>
        <div className="px-3 pt-2 text-[10px] text-slate-500 leading-snug">
          Names scoring {REVIEW_SCORE} to {BLOCK_SCORE} can sign up but wait here for a decision (higher scores are refused at sign-up, and only show up here if they got past it). Scores are worked out in your browser from the word lists.
        </div>
        <div className="flex flex-wrap gap-1 px-3 py-2">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-2 py-0.5 border font-bold ${tab === k ? 'border-cyan-400 bg-cyan-950 text-cyan-300' : 'border-[#2b3548] text-slate-400 hover:text-slate-200'}`}>{label}</button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1.5">
          {!data ? <div className="text-slate-500 italic">Loading…</div>
            : tab === 'review' ? (toReview.length ? toReview.map((n) => row(n)) : empty('Nothing to review.'))
            : tab === 'waiting' ? (waiting.length ? waiting.map((n) => row(n, false)) : empty('Nobody is waiting to pick a new name.'))
            : tab === 'decided' ? (past.length ? past.map((r: Review) => (
                <div key={r.uid} className="flex items-center gap-2 p-2 border border-[#222a3b] bg-[#12151e]">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-100 break-all">{r.username}</div>
                    <div className="text-[10px] text-slate-500">{r.reason ? `matched: ${r.reason} · ` : ''}{when(r.at)}</div>
                  </div>
                  {scoreChip(r.score)}
                  <span className={`px-1.5 py-0.5 border font-bold ${r.decision === 'allowed' ? 'border-emerald-600/60 text-emerald-300' : 'border-rose-600/60 text-rose-300'}`}>{r.decision}</span>
                </div>
              )) : empty('No decisions yet.'))
            : tab === 'banned' ? (data.banned.length ? data.banned.map((b) => (
                <div key={b.name} className="flex items-center gap-2 p-2 border border-[#222a3b] bg-[#12151e]">
                  <span className="font-bold text-slate-100 flex-1 break-all">{b.username}</span>
                  <span className="text-[10px] text-slate-500">{when(b.at)}</span>
                  <button onClick={() => unbanName(b.name).then(reload).catch((e: Error) => onError(e.message))} className="px-2 py-0.5 border border-[#2b3548] text-slate-300 hover:bg-[#202737]" data-tip="Let anyone claim this name again">Remove</button>
                </div>
              )) : empty('No denied names.'))
            : (
              <>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search usernames" className="w-full bg-[#12151e] border border-[#2b3548] px-2 py-1 text-slate-200 outline-none focus:border-cyan-400" />
                {all.map((n) => row(n, !n.flagged))}
              </>
            )}
        </div>
        </>)}
      </div>
    </div>
  );
}

/** Modpacks people asked for, most votes first. Remove one once it's added (or ruled out). */
function PackRequests({ onError }: { onError: (m: string) => void }) {
  const [list, setList] = useState<PackSuggestion[] | null>(null);
  const load = useCallback(() => { listPackSuggestions().then(setList).catch((e) => onError((e as Error).message)); }, [onError]);
  useEffect(load, [load]);
  if (!list) return <div className="p-3 text-slate-500">Loading…</div>;
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1">
      <div className="text-[10px] text-slate-500 pb-1">From "Suggest a pack" in the modpack menu. Each signed-in user can vote once per pack.</div>
      {list.length ? list.map((p) => (
        <div key={p.id} className="flex items-center gap-2 border border-[#222a3b] bg-[#12151e] px-2 py-1.5">
          <span className="w-10 text-center text-base font-bold text-fuchsia-300" data-tip={`${p.votes} vote${p.votes === 1 ? '' : 's'}`}>{p.votes}</span>
          <span className="flex-1 min-w-0">
            <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="block font-bold text-slate-100 hover:text-cyan-300 truncate">{p.name}</a>
            <span className="block text-[10px] text-slate-500 truncate">{p.source} · {p.url}</span>
          </span>
          <button onClick={() => { if (confirm(`Remove the request for ${p.name}?`)) removePackSuggestion(p.id).then(load).catch((e) => onError((e as Error).message)); }} className="px-2 py-0.5 border border-rose-600/60 text-rose-300 hover:bg-rose-950 font-bold">Remove</button>
        </div>
      )) : <div className="text-slate-500 italic">No pack requests yet.</div>}
    </div>
  );
}

const reasonLabel = (r: string) => REPORT_REASONS.find(([k]) => k === r)?.[1] ?? r;

/** Shared flows: reported ones (grouped, most reports first), ones whose text needs a look, and all. */
function FlowModeration({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadFlowModeration>> | null>(null);
  const [commentReports, setCommentReports] = useState<CommentReport[]>([]);
  const [tab, setTab] = useState<'reported' | 'comments' | 'review' | 'all'>('reported');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = useCallback(() => {
    loadFlowModeration().then(setData).catch((e: Error) => onError(e.message));
    loadCommentReports().then(setCommentReports).catch((e: Error) => onError(e.message));
  }, [onError]);
  useEffect(reload, [reload]);
  // Reported comments, one group per comment, most reports first.
  const commentGroups = useMemo(() => {
    const m = new Map<string, CommentReport[]>();
    for (const r of commentReports) m.set(`${r.buildId}/${r.commentId}`, [...(m.get(`${r.buildId}/${r.commentId}`) ?? []), r]);
    return [...m.values()].sort((a, b) => b.length - a.length);
  }, [commentReports]);

  const byId = useMemo(() => new Map((data?.flows ?? []).map((f) => [f.id, f])), [data]);
  const groups = useMemo(() => {
    const m = new Map<string, FlowReport[]>();
    for (const r of data?.reports ?? []) m.set(r.buildId, [...(m.get(r.buildId) ?? []), r]);
    return [...m.entries()].map(([id, list]) => ({ id, list: list.sort((a, b) => b.at - a.at), name: byId.get(id)?.name ?? list[0].buildName, gone: !byId.has(id) }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [data, byId]);
  const toReview = (data?.flows ?? []).filter((f) => f.score >= REVIEW_SCORE && !f.reviewed).sort((a, b) => b.score - a.score);
  const run = (key: string, fn: () => Promise<unknown>) => { setBusy(key); fn().then(reload).catch((e: Error) => onError(e.message)).finally(() => setBusy(null)); };
  const remove = (id: string, name: string) => { if (window.confirm(`Remove "${name}" from Community for everyone? This can't be undone.`)) run(id, () => deleteBuild(id)); };
  const btn = 'px-2 py-0.5 border font-bold disabled:opacity-40';
  const actions = (f: { id: string; name: string }, extra?: ReactNode) => (
    <span className="flex flex-wrap gap-1 justify-end">
      <a href={flowLink(f.id)} target="_blank" rel="noopener noreferrer" className={`${btn} border-cyan-600/60 text-cyan-300 hover:bg-cyan-950`}>View</a>
      {extra}
      <button disabled={busy === f.id} onClick={() => remove(f.id, f.name)} className={`${btn} border-rose-600/60 text-rose-300 hover:bg-rose-950`}>Remove flow</button>
    </span>
  );
  const flowRow = (f: FlowEntry, allow: boolean) => (
    <div key={f.id} className="p-2 border border-[#222a3b] bg-[#12151e] space-y-1">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-slate-100 break-words">{f.name}</div>
          <div className="text-[10px] text-slate-500">by {f.author}{f.reason ? ` · matched ${f.reason}` : ''}{f.reviewed ? ' · checked' : ''}</div>
          {f.description && <div className="text-[11px] text-slate-400 line-clamp-2 break-words">{f.description}</div>}
        </div>
        <span className={`px-1.5 py-0.5 border text-[10px] font-bold ${f.score >= BLOCK_SCORE ? 'border-rose-500/60 text-rose-300' : f.score >= REVIEW_SCORE ? 'border-amber-500/60 text-amber-300' : 'border-[#2b3548] text-slate-400'}`}>{f.score.toFixed(2)}</span>
      </div>
      {actions(f, allow && <button disabled={busy === f.id} onClick={() => run(f.id, () => allowFlow(f))} className={`${btn} border-emerald-600/60 text-emerald-300 hover:bg-emerald-950`}>Allow</button>)}
    </div>
  );
  const empty = (t: string) => <div className="p-6 border border-[#222a3b] text-center text-slate-500 italic">{t}</div>;
  const tabs = [['reported', `Reported (${groups.length})`], ['comments', `Reported comments (${commentGroups.length})`], ['review', `Text to check (${toReview.length})`], ['all', `All flows (${data?.flows.length ?? 0})`]] as const;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 px-3 py-2">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-2 py-0.5 border font-bold ${tab === k ? 'border-cyan-400 bg-cyan-950 text-cyan-300' : 'border-[#2b3548] text-slate-400 hover:text-slate-200'}`}>{label}</button>
        ))}
        <button onClick={reload} className="ml-auto px-2 py-0.5 border border-[#2b3548] text-slate-300 hover:bg-[#202737]">Refresh</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1.5">
        {!data ? <div className="text-slate-500 italic">Loading…</div>
          : tab === 'reported' ? (groups.length ? groups.map((g) => {
              const counts = new Map<string, number>();
              for (const r of g.list) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
              return (
                <div key={g.id} className="p-2 border border-[#222a3b] bg-[#12151e] space-y-1.5">
                  <button onClick={() => setOpen(open === g.id ? null : g.id)} className="w-full flex items-center gap-2 text-left" data-tip="Show each report">
                    <span className="font-bold text-slate-100 flex-1 break-words">{g.name}{g.gone ? ' (already removed)' : ''}</span>
                    <span className="px-1.5 py-0.5 border border-rose-500/60 text-rose-300 font-bold">{g.list.length} report{g.list.length === 1 ? '' : 's'}</span>
                  </button>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => <span key={r} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-300">{reasonLabel(r)} ×{n}</span>)}
                  </div>
                  {open === g.id && (
                    <div className="space-y-1 border-t border-[#1d2433] pt-1.5">
                      {g.list.map((r) => (
                        <div key={r.id} className="text-[11px]">
                          <span className="text-slate-500">{new Date(r.at).toLocaleString()} · {reasonLabel(r.reason)}</span>
                          {r.info && <div className="text-slate-300 whitespace-pre-line break-words">{r.info}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {actions({ id: g.id, name: g.name }, <button disabled={busy === g.id} onClick={() => run(g.id, () => dismissReports(g.list.map((r) => r.id)))} className={`${btn} border-[#2b3548] text-slate-300 hover:bg-[#202737]`} data-tip="Keep the flow and clear these reports">Dismiss reports</button>)}
                </div>
              );
            }) : empty('No reported flows.'))
          : tab === 'comments' ? (commentGroups.length ? commentGroups.map((list) => {
              const c = list[0];
              const counts = new Map<string, number>();
              for (const r of list) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
              const key = `${c.buildId}/${c.commentId}`;
              return (
                <div key={key} className="p-2 border border-[#222a3b] bg-[#12151e] space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-slate-500"><span className="text-slate-300 font-bold">{c.commentAuthor}</span> on "{c.buildName}"</div>
                      <div className="text-slate-200 whitespace-pre-line break-words">{c.commentText}</div>
                    </div>
                    <span className="px-1.5 py-0.5 border border-rose-500/60 text-rose-300 font-bold whitespace-nowrap">{list.length} report{list.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {[...counts.entries()].map(([r, n]) => <span key={r} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-300">{reasonLabel(r)} ×{n}</span>)}
                  </div>
                  {list.some((r) => r.info) && <div className="text-[11px] text-slate-400 space-y-0.5">{list.filter((r) => r.info).map((r) => <div key={r.id} className="break-words">"{r.info}"</div>)}</div>}
                  <span className="flex flex-wrap gap-1 justify-end">
                    <a href={flowLink(c.buildId)} target="_blank" rel="noopener noreferrer" className={`${btn} border-cyan-600/60 text-cyan-300 hover:bg-cyan-950`}>View flow</a>
                    <button disabled={busy === key} onClick={() => run(key, () => dismissCommentReports(list.map((r) => r.id)))} className={`${btn} border-[#2b3548] text-slate-300 hover:bg-[#202737]`} data-tip="Keep the comment and clear these reports">Dismiss reports</button>
                    <button disabled={busy === key} onClick={() => { if (window.confirm('Remove this comment for everyone?')) run(key, () => removeComment(c.buildId, c.commentId, list.map((r) => r.id))); }} className={`${btn} border-rose-600/60 text-rose-300 hover:bg-rose-950`}>Remove comment</button>
                  </span>
                </div>
              );
            }) : empty('No reported comments.'))
          : tab === 'review' ? (toReview.length ? toReview.map((f) => flowRow(f, true)) : empty('No flow names or descriptions need checking.'))
          : [...data.flows].sort((a, b) => b.createdAt - a.createdAt).map((f) => flowRow(f, false))}
      </div>
    </>
  );
}
