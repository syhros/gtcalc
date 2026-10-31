import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, Flag, GitFork, Link2, Pencil, MessageSquare, Minus, Plus, Search, ThumbsUp, Trash2, Upload, X } from 'lucide-react';
import { TIER_ORDER, TIERS, type CanvasNode, type VoltageTier } from '../types';
import { NODE_WIDE, NODE_WIDTH, SUPPLY_WIDTH } from './NodeCard';
import { compact, euUnit, euValue, formatEU, formatRate, useUnits } from '../format';
import { analyzeFlow } from '../buildStats';
import {
  FLOW_TAGS, REPORT_REASONS, addComment, updateBuildDetails, communityEnabled, flowLink, tagLabel, deleteBuild, getSchematic, reportBuild, reportComment, subscribeBuilds, subscribeComments, toggleFavorite, toggleUpvote, upvotes, voteComment,
  type Build, type BuildComment, type FlowTag, type ReportReason, type User,
} from '../community';
import { ItemIcon } from './ItemIcon';
import { PixelIcon } from './PixelIcon';
import { Dropdown } from './Dropdown';
import { SiteFooter } from './SiteFooter';

export type BuildsTab = 'list' | 'mine' | 'favorites';
type Detail = { id: string; focusComments?: boolean } | { author: string; authorId: string } | null;
type SortKey = 'recent' | 'rating' | 'favorites' | 'machines' | 'eutUse' | 'name';

interface Props {
  pack: string;
  user: User | null;
  tab: BuildsTab;
  onTab: (t: BuildsTab) => void;
  yourFlows: ReactNode; // the saved-flows list (My flows tab)
  examples: Build[]; // made from the pack's recipes, shown alongside shared builds
  onOpenFlow: (build: Build) => void; // copy into Saves and open on the canvas
  onViewFlow: (build: Build) => void; // open it on the canvas to look at only (nothing saved)
  isOwnFlow?: (build: Build) => boolean; // a build of the user's own saved flow: edit it rather than copy
  onExport: (build: Build) => void;
  onNeedLogin: (reason: string) => void;
  /** Your saved flows with machines, for Share a flow (blocked: why it can't be shared). */
  shareChoices: { id: string; name: string; machines: number; open: boolean; blocked?: string }[];
  onShareFlow: (id: string) => void;
  navKey?: number; // bumped by the header's Community / My flows: close any open flow page
  jump?: { id: string; comments: boolean; n: number } | null; // open this flow's page (from a notification)
  onError: (message: string) => void; // shows a toast (errors and confirmations)
  initialFlowId?: string | null; // opened from a shared link (?flow=<id>)
  onViewing?: (id: string | null) => void; // the flow on screen, for the address bar
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const tierIdx = (t: string) => TIER_ORDER.indexOf(t as never);

/**
 * Community flows: a filterable grid (top builds in their own row first), a detail view with a
 * simplified tree, inputs / surplus / output, comments and votes, and a favourites list.
 * Rendered instead of the canvas (not on top of it), so the canvas isn't drawn meanwhile.
 */
export function BuildsPage(props: Props) {
  useUnits(); // re-render when the display units change
  return <BuildsPageInner {...props} />;
}

function BuildsPageInner({ pack, user, tab, onTab, yourFlows, examples, onOpenFlow, onViewFlow, isOwnFlow, onExport, onNeedLogin, shareChoices, onShareFlow, navKey, jump, onError, initialFlowId, onViewing }: Props) {
  const [shared, setShared] = useState<Build[]>([]);
  const [loading, setLoading] = useState(communityEnabled);
  const [detailOf, setDetailOf] = useState<Detail>(initialFlowId ? { id: initialFlowId } : null);
  const viewingId = detailOf && 'id' in detailOf ? detailOf.id : null;
  const firstNav = useRef(navKey);
  useEffect(() => { if (navKey !== firstNav.current) setDetailOf(null); }, [navKey]);
  const lastJump = useRef<number | undefined>(undefined); // App clears jump when the page closes
  useEffect(() => { if (jump && jump.n !== lastJump.current) { lastJump.current = jump.n; setDetailOf({ id: jump.id, focusComments: jump.comments }); } }, [jump]);
  useEffect(() => { onViewing?.(viewingId); }, [viewingId, onViewing]);
  const [count, setCount] = useState<number | null>(null); // flows matching the list's filters
  useEffect(() => {
    if (!communityEnabled) return;
    return subscribeBuilds(pack, (list) => { setShared(list); setLoading(false); }, (e) => { setLoading(false); onError(e.message); });
  }, [pack, onError]);
  const builds = useMemo(() => [...shared, ...examples], [shared, examples]);

  // Votes, favourites and comments need an account.
  const guard = (reason: string, fn: () => Promise<unknown>) => {
    if (!user) { onNeedLogin(reason); return; }
    fn().catch((e: Error) => onError(e.message));
  };
  const actions: Actions = {
    upvote: (b) => guard('Log in to upvote flows.', () => toggleUpvote(b)),
    fav: (b) => guard('Log in to favourite flows.', () => toggleFavorite(b)),
  };

  const detail = detailOf && 'id' in detailOf ? builds.find((b) => b.id === detailOf.id) : undefined;
  const [reporting, setReporting] = useState<{ build: Build; comment?: BuildComment } | null>(null);
  const favCount = user ? builds.filter((b) => b.favoriters.includes(user.uid)).length : 0;
  const view = (b: Build, focusComments?: boolean) => setDetailOf({ id: b.id, focusComments });
  const showAuthor = (b: Build) => setDetailOf({ author: b.author, authorId: b.authorId });
  return (
    <div role="main" aria-label="Community flows" className="flex-1 min-h-0 overflow-y-auto bg-[#11141c] text-xs">
      <div className="max-w-7xl mx-auto p-4 space-y-3">
        {detailOf ? (
          // A flow or a player's page: just the way back (the tabs come back with the list).
          <div className="flex items-center gap-2">
            <button onClick={() => setDetailOf(null)} className="flex items-center gap-1 px-2 py-1 border border-[#2b3548] text-slate-300 hover:text-slate-100 hover:bg-[#202737] font-bold">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to the list
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {/* My flows is its own page (from the header); Community has All flows / My favourites. */}
            <div className="text-lg font-bold text-slate-100">{tab === 'mine' ? 'My flows' : 'Community'}</div>
            {tab !== 'mine' && (
              <div className="flex flex-wrap border border-[#2b3548] ml-1">
                {(['list', 'favorites'] as const).map((k) => (
                  <button key={k} onClick={() => onTab(k)} className={`px-2.5 py-1 font-bold ${tab === k ? 'bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>
                    {k === 'list' ? 'All flows' : 'My favourites'}
                  </button>
                ))}
              </div>
            )}
            <span className="ml-auto text-slate-500">{tab !== 'mine' ? (loading ? 'Loading…' : `Total ${tab === 'list' ? builds.length : favCount} flow${(tab === 'list' ? builds.length : favCount) === 1 ? '' : 's'}${count != null && count !== (tab === 'list' ? builds.length : favCount) ? ` · ${count} match` : ''}`) : ''}</span>
            {/* My flows shares from each row; Community picks one of your flows. */}
            {tab !== 'mine' && (
              <Dropdown
                label={<><Upload className="w-3.5 h-3.5" /> Share a flow</>}
                className="bg-emerald-700 hover:bg-emerald-600 border-emerald-500 text-white font-bold"
                tip="Pick one of your flows to share"
              >
                {(close) => shareChoices.length ? (
                  <div className="max-h-[50vh] overflow-y-auto">
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500">Your flows</div>
                    {[...shareChoices].sort((x, y) => Number(y.open) - Number(x.open)).map((f) => (
                      <button
                        key={f.id}
                        disabled={!!f.blocked}
                        onClick={() => { close(); onShareFlow(f.id); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-[#202737] disabled:opacity-45 disabled:hover:bg-transparent flex items-center gap-2"
                      >
                        <span className="flex-1 min-w-0 truncate text-slate-100">{f.name}</span>
                        {f.open && <span className="text-[9px] px-1 border border-cyan-500/60 text-cyan-300 uppercase">Open</span>}
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">{f.blocked ?? `${f.machines} nodes`}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-2 text-slate-400">Your flows with machines show here. Build one on the canvas first.</div>
                )}
              </Dropdown>
            )}
          </div>
        )}
        {!communityEnabled && <div className="p-2 border border-amber-700/60 bg-amber-950/30 text-amber-200">The community server isn't connected in this build, so only the examples are shown.</div>}
        {!detailOf && tab === 'list' && <BuildList builds={builds} user={user} actions={actions} onView={view} onAuthor={showAuthor} onCount={setCount} />}
        {!detailOf && tab === 'mine' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,620px)_minmax(0,1fr)] items-start">
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase font-bold tracking-wider text-slate-300">Saved flows</div>
              {yourFlows}
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="text-[11px] uppercase font-bold tracking-wider text-slate-300">Shared to Community</div>
              {!user ? (
                <div className="p-6 border border-[#222a3b] text-center text-slate-400 space-y-2">
                  <div>Log in to share flows and see them here.</div>
                  <button onClick={() => onNeedLogin('Log in to share flows.')} className="px-3 py-1 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-950 font-bold">Log in</button>
                </div>
              ) : (() => {
                const mine = shared.filter((b) => b.authorId === user.uid);
                return mine.length
                  ? <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">{mine.map((b) => <BuildCard key={b.id} b={b} user={user} actions={actions} onView={view} />)}</div>
                  : <div className="p-6 border border-[#222a3b] text-center text-slate-500 italic">Nothing shared yet. Use Share on a saved flow.</div>;
              })()}
            </div>
          </div>
        )}
        {!detailOf && tab === 'favorites' && (
          !user ? (
            <div className="p-6 border border-[#222a3b] text-center text-slate-400 space-y-2">
              <div>Log in to keep a list of favourite flows.</div>
              <button onClick={() => onNeedLogin('Log in to see your favourites.')} className="px-3 py-1 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-950 font-bold">Log in</button>
            </div>
          ) : <BuildList builds={builds.filter((b) => b.favoriters.includes(user.uid))} user={user} actions={actions} onView={view} onAuthor={showAuthor} onCount={setCount} noTop empty="No favourites yet. Press the heart on a flow to add it here." />
        )}
        {detailOf && 'author' in detailOf && <AuthorBuilds author={detailOf.author} authorId={detailOf.authorId} builds={shared} user={user} actions={actions} onView={view} />}
        {detailOf && 'id' in detailOf && (detail
          ? <BuildDetail build={detail} user={user} actions={actions} focusComments={detailOf.focusComments} own={!!isOwnFlow?.(detail)} onOpen={onOpenFlow} onView={onViewFlow} onExport={onExport} onNeedLogin={onNeedLogin} onError={onError} onDeleted={() => setDetailOf(null)} onAuthor={(x) => setDetailOf({ author: x.author, authorId: x.authorId })} onReport={(x, c) => (user ? setReporting({ build: x, comment: c }) : onNeedLogin(c ? 'Log in to report a comment.' : 'Log in to report a flow.'))} />
          : <div className="text-slate-500 italic">{loading || (!examples.length && initialFlowId?.startsWith('example')) ? 'Loading…' : 'That flow no longer exists, or the link is wrong.'}</div>)}
        <SiteFooter className="pt-6 mt-4 border-t border-[#222a3b]" />
      </div>
      {reporting && <ReportModal build={reporting.build} comment={reporting.comment} onClose={() => setReporting(null)} onDone={() => { setReporting(null); onError('Thanks: the moderators will take a look'); }} onError={onError} />}
    </div>
  );
}

/** Report a flow: a reason, and optionally more detail, sent to the moderators. */
function ReportModal({ build, comment, onClose, onDone, onError }: { build: Build; comment?: BuildComment; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [reason, setReason] = useState<ReportReason>('offensive');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const send = () => { setBusy(true); (comment ? reportComment(build, comment, reason, info) : reportBuild(build, reason, info)).then(onDone).catch((e: Error) => onError(e.message)).finally(() => setBusy(false)); };
  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-[400px] max-w-full bg-[#161a24] border border-[#2b3548] shadow-2xl p-4 space-y-3 text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Flag className="w-4 h-4 text-rose-300" />
          <div className="font-bold text-sm text-slate-100 flex-1 break-words">{comment ? `Report ${comment.author}'s comment` : `Report "${build.name}"`}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" data-tip="Close" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <label className="block space-y-1">
          <span className="text-slate-400">Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className="w-full bg-[#12151e] border border-[#2b3548] px-2 py-1.5 text-slate-100 outline-none focus:border-cyan-400">
            {REPORT_REASONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-slate-400">More detail (optional)</span>
          <textarea value={info} onChange={(e) => setInfo(e.target.value)} maxLength={500} rows={3} placeholder="Anything that helps the moderators" className="w-full bg-[#12151e] border border-[#2b3548] px-2 py-1.5 text-slate-100 outline-none focus:border-cyan-400 resize-y" />
        </label>
        <div className="text-[10px] text-slate-500">Only moderators see reports. Reporting the same {comment ? 'comment' : 'flow'} again replaces your earlier report.</div>
        <button onClick={send} disabled={busy} className="w-full py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-500/60 text-rose-200 font-bold disabled:opacity-40">Send report</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- grid
interface Actions { upvote: (b: Build) => void; fav: (b: Build) => void }

/** Builds are rated with upvotes only: click to upvote, click again to take it back. */
function UpvoteButton({ build, user, onVote }: { build: Build; user: User | null; onVote: () => void }) {
  const mine = !!user && build.upvoters.includes(user.uid);
  return (
    <button onClick={(e) => { e.stopPropagation(); onVote(); }} className={`px-1.5 py-0.5 border inline-flex items-center gap-1 ${mine ? 'border-emerald-400 text-emerald-300 bg-emerald-950' : 'border-[#2b3548] text-slate-400 hover:text-emerald-300'}`} data-tip={mine ? 'Remove your upvote' : 'Upvote'}>
      <ThumbsUp className="w-3 h-3" /> {upvotes(build)}
    </button>
  );
}

/** How many people made their own copy (not clickable). */
function CopyCount({ b }: { b: Build }) {
  const n = b.forkers?.length ?? 0;
  return (
    <span className="px-1.5 py-0.5 text-slate-400 inline-flex items-center gap-1" data-tip={`${n} ${n === 1 ? 'person has' : 'people have'} made their own copy`}>
      <GitFork className="w-3 h-3" /> {n}
    </span>
  );
}

function FavButton({ build, user, onFav }: { build: Build; user: User | null; onFav: () => void }) {
  const on = !!user && build.favoriters.includes(user.uid);
  return (
    <button onClick={(e) => { e.stopPropagation(); onFav(); }} className={`px-1.5 py-0.5 border inline-flex items-center gap-1 ${on ? 'border-pink-400 text-pink-300 bg-pink-950/60' : 'border-[#2b3548] text-slate-400 hover:text-pink-300'}`} data-tip={on ? 'Remove from favourites' : 'Add to favourites'}>
      <PixelIcon name="heart" className="w-2.5 h-2.5" /> {build.favoriters.length}
    </button>
  );
}

/** One flow in the grid. */
function BuildCard({ b, user, actions, onView, top, onAuthor }: { b: Build; user: User | null; actions: Actions; onView: (b: Build, comments?: boolean) => void; top?: boolean; onAuthor?: (b: Build) => void }) {
  return (
    <div onClick={() => onView(b)} className={`h-full flex flex-col gap-1.5 p-2.5 border cursor-pointer transition-colors ${top ? 'border-pink-500/50 bg-pink-950/15 hover:border-pink-400' : 'border-[#222a3b] bg-[#12151e] hover:border-[#3a4660]'}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        {b.stats.output && <ItemIcon id={b.stats.output.id} size={40} />}
        <div className="min-w-0 flex-1">
          {/* One line per name (cut short, full name on hover), so cards in a row line up. */}
          <div className="font-bold text-slate-100 text-[13px] leading-tight truncate" data-tip-cut="" data-tip={b.name}>{b.name}</div>
          <div className="text-[11px] text-slate-500">by {b.example || !onAuthor ? <span className="text-slate-300">{b.author}</span> : (
            <button onClick={(e) => { e.stopPropagation(); onAuthor(b); }} className="text-cyan-300 hover:underline" data-tip={`All of ${b.author}'s flows`}>{b.author}</button>
          )}</div>
          <div className="text-[10px] text-slate-500">{fmtDate(b.createdAt)}</div>
        </div>
        {(b.example || b.tag) && (
          <span className={`text-[9px] px-1 border flex-shrink-0 uppercase ${b.example ? 'border-slate-600 text-slate-400' : 'border-violet-500/60 text-violet-300'}`} data-tip={b.example ? 'One of the examples made with gtcalc' : `Tagged ${tagLabel(b.tag)}`}>
            {b.example ? 'Example' : tagLabel(b.tag)}
          </span>
        )}
      </div>
      {b.stats.output && (
        <div className="text-[11px] text-emerald-300 truncate" data-tip-cut="" data-tip={b.stats.output.name}>
          {b.stats.output.name}{b.stats.output.perSec != null && b.stats.output.unit ? ` · ${formatRate(b.stats.output.perSec, b.stats.output.unit)}` : ''}
        </div>
      )}
      {/* The power cell is a little wider so "+252k net" fits. */}
      <div className="grid grid-cols-[1fr_1fr_1.35fr] gap-1 text-[13px]">
        <div className="border border-[#1f2738] px-1 py-1 min-w-0"><div className="text-slate-500 text-[11px]">Machines</div><div className="text-slate-100 font-bold">{b.stats.machines}</div></div>
        <div className="border border-[#1f2738] px-1 py-1 min-w-0"><div className="text-slate-500 text-[11px]">Tiers</div><div className="truncate" data-tip={`Machines from ${b.stats.lowTier} up to ${b.stats.topTier}`}>{b.stats.lowTier === b.stats.topTier ? <TierText t={b.stats.topTier} /> : <><TierText t={b.stats.lowTier} /><span className="text-slate-500">–</span><TierText t={b.stats.topTier} /></>}</div></div>
        {/* Power: what it draws, or for generating flows the net it makes. */}
        <div className="border border-[#1f2738] px-1 py-1 min-w-0">
          <div className="text-slate-500 text-[11px]">{euUnit()}</div>
          {b.stats.eutGen > 0
            ? <div className={`font-bold truncate ${b.stats.eutGen >= b.stats.eutUse ? 'text-yellow-300' : 'text-rose-300'}`} data-tip={`Uses ${formatEU(b.stats.eutUse)}, makes ${formatEU(b.stats.eutGen)}`}>{b.stats.eutGen >= b.stats.eutUse ? '+' : ''}{compact(euValue(b.stats.eutGen - b.stats.eutUse))} net</div>
            : <div className="text-amber-400 font-bold truncate" data-tip={`Uses ${formatEU(b.stats.eutUse)} on average`}>{compact(euValue(b.stats.eutUse))}</div>}
        </div>
      </div>
      <div className="flex items-center gap-1 mt-auto pt-1">
        <UpvoteButton build={b} user={user} onVote={() => actions.upvote(b)} />
        <FavButton build={b} user={user} onFav={() => actions.fav(b)} />
        <button onClick={(e) => { e.stopPropagation(); onView(b, true); }} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-400 hover:text-slate-100 inline-flex items-center gap-1" data-tip="Comments">
          <MessageSquare className="w-3 h-3" /> {b.commentCount}
        </button>
        <CopyCount b={b} />
        <button onClick={(e) => { e.stopPropagation(); onView(b); }} className="ml-auto px-2 py-0.5 border border-cyan-600/60 text-cyan-300 hover:bg-cyan-950 font-bold">View</button>
      </div>
    </div>
  );
}

const TOP_COUNT = 4;
const GRID = 'grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-fr'; // equal-height rows

function BuildList({ builds, user, actions, onView, onAuthor, onCount, noTop, empty }: { builds: Build[]; user: User | null; actions: Actions; onView: (b: Build, comments?: boolean) => void; onAuthor: (b: Build) => void; onCount: (n: number) => void; noTop?: boolean; empty?: string }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [f, setF] = useState({ maxUse: '', minGen: '', maxTop: '', minLow: '', maxMachines: '', tag: '' });
  const num = (s: string) => (s.trim() ? Number(s.replace(/k$/i, '000').replace(/m$/i, '000000')) : NaN);
  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    return builds.filter((b) => {
      if (text && !b.name.toLowerCase().includes(text) && !b.author.toLowerCase().includes(text) && !(b.stats.output?.name.toLowerCase().includes(text))) return false;
      const s = b.stats;
      if (!Number.isNaN(num(f.maxUse)) && s.eutUse > num(f.maxUse)) return false;
      if (!Number.isNaN(num(f.minGen)) && s.eutGen < num(f.minGen)) return false;
      if (!Number.isNaN(num(f.maxMachines)) && s.machines > num(f.maxMachines)) return false;
      if (f.maxTop && tierIdx(s.topTier) > tierIdx(f.maxTop)) return false;
      if (f.minLow && tierIdx(s.lowTier) < tierIdx(f.minLow)) return false;
      if (f.tag && (f.tag === 'example' ? !b.example : b.tag !== f.tag)) return false;
      return true;
    });
  }, [builds, q, f]);
  useEffect(() => onCount(filtered.length), [filtered.length, onCount]);
  // Top row: the most favourited builds (then most upvoted), only ones with any favourites or upvotes.
  const top = useMemo(() => noTop ? [] : [...filtered]
    .filter((b) => b.favoriters.length || upvotes(b))
    .sort((a, b) => b.favoriters.length - a.favoriters.length || upvotes(b) - upvotes(a) || b.createdAt - a.createdAt)
    .slice(0, TOP_COUNT), [filtered, noTop]);
  const rest = useMemo(() => {
    const by: Record<SortKey, (a: Build, b: Build) => number> = {
      recent: (a, b) => b.createdAt - a.createdAt,
      rating: (a, b) => upvotes(b) - upvotes(a) || b.createdAt - a.createdAt,
      favorites: (a, b) => b.favoriters.length - a.favoriters.length || b.createdAt - a.createdAt,
      machines: (a, b) => a.stats.machines - b.stats.machines,
      eutUse: (a, b) => a.stats.eutUse - b.stats.eutUse,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    const shown = new Set(top);
    return filtered.filter((b) => !shown.has(b)).sort(by[sort]);
  }, [filtered, sort, top]);
  // Boxes grow to fill each row and wrap before their placeholders get cut off (two by two on phones).
  const input = 'bg-[#12151e] border border-[#2b3548] px-1.5 py-1 text-slate-200 outline-none focus:border-cyan-400 flex-1 max-md:min-w-[40%]';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 p-2 border border-[#222a3b] bg-[#141822]">
        <span className="relative flex flex-1 min-w-[200px] max-md:w-full">
          <Search className="w-3.5 h-3.5 absolute left-1.5 top-1.5 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, user or output" className={`${input} pl-6 w-full`} />
        </span>
        <input value={f.maxUse} onChange={(e) => setF({ ...f, maxUse: e.target.value })} placeholder="Max EU/t used" className={`${input} min-w-[120px]`} data-tip="Flows drawing at most this much (100, 10k, 1M)" aria-label="Flows drawing at most this much (100, 10k, 1M)" />
        <input value={f.minGen} onChange={(e) => setF({ ...f, minGen: e.target.value })} placeholder="Min EU/t made" className={`${input} min-w-[120px]`} data-tip="Flows generating at least this much" aria-label="Flows generating at least this much" />
        <input value={f.maxMachines} onChange={(e) => setF({ ...f, maxMachines: e.target.value })} placeholder="Max machines" className={`${input} min-w-[110px]`} />
        <select value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} className={input} data-tip="Only flows with this tag" aria-label="Only flows with this tag">
          <option value="">Tag: any</option>
          {FLOW_TAGS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          <option value="example">Examples</option>
        </select>
        <select value={f.minLow} onChange={(e) => setF({ ...f, minLow: e.target.value })} className={input} data-tip="Tiers from: flows whose lowest tier is at least this" aria-label="Tiers from: flows whose lowest tier is at least this">
          <option value="">Tiers from: any</option>
          {TIER_ORDER.map((t) => <option key={t} value={t}>Tiers from: {t}</option>)}
        </select>
        <select value={f.maxTop} onChange={(e) => setF({ ...f, maxTop: e.target.value })} className={input} data-tip="To: flows whose highest tier is at most this" aria-label="To: flows whose highest tier is at most this">
          <option value="">To: any</option>
          {TIER_ORDER.map((t) => <option key={t} value={t}>To: {t}</option>)}
        </select>
        <label className="flex items-center gap-1 text-slate-400 max-md:w-full">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={input}>
            <option value="recent">Most recent</option>
            <option value="rating">Most upvoted</option>
            <option value="favorites">Most favourited</option>
            <option value="machines">Fewest machines</option>
            <option value="eutUse">Lowest power</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      {top.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase font-bold tracking-wider text-pink-300 flex items-center gap-1.5"><PixelIcon name="heart" className="w-3 h-3" /> Top flows</div>
          <div className={GRID}>{top.map((b) => <BuildCard key={b.id} b={b} user={user} actions={actions} onView={onView} onAuthor={onAuthor} top />)}</div>
        </div>
      )}
      <div className="space-y-1.5">
        {top.length > 0 && <div className="text-[11px] uppercase font-bold tracking-wider text-slate-400">All flows</div>}
        {rest.length ? <div className={GRID}>{rest.map((b) => <BuildCard key={b.id} b={b} user={user} actions={actions} onView={onView} onAuthor={onAuthor} />)}</div>
          : <div className="p-6 border border-[#222a3b] text-center text-slate-500 italic">{filtered.length ? 'Every match is in Top flows.' : !builds.length && empty ? empty : 'No flows match.'}</div>}
      </div>
    </div>
  );
}


/** A tier name in its tier colour (as on the canvas badges). */
function TierText({ t }: { t: string }) {
  const info = TIERS[t as VoltageTier];
  return <span className="font-bold" style={{ color: info?.color ?? '#94a3b8' }}>{t}</span>;
}

/** EU/t used (amber), made (yellow) and net (yellow when generation covers it, red when short). */
function StatChips({ stats }: { stats: Build['stats'] }) {
  const net = stats.eutGen - stats.eutUse;
  return (
    <>
      <span className="text-slate-600 max-md:hidden">·</span>
      <span className="text-amber-400 font-bold">{formatEU(stats.eutUse)} used</span>
      {stats.eutGen > 0 && (
        <>
          <span className="text-slate-600">·</span>
          <span className="text-yellow-300 font-bold">+{formatEU(stats.eutGen)} made</span>
          <span className="text-slate-600">·</span>
          <span className={`font-bold px-1 border ${net >= 0 ? 'text-yellow-200 border-yellow-500/50 bg-yellow-950/40' : 'text-rose-300 border-rose-500/50 bg-rose-950/40'}`}>net {net >= 0 ? '+' : ''}{formatEU(net)}</span>
        </>
      )}
    </>
  );
}

/** Every public flow by one player. */
function AuthorBuilds({ author, authorId, builds, user, actions, onView }: { author: string; authorId: string; builds: Build[]; user: User | null; actions: Actions; onView: (b: Build, comments?: boolean) => void }) {
  const theirs = builds.filter((b) => b.authorId === authorId);
  const totals = { builds: theirs.length, up: theirs.reduce((a, b) => a + upvotes(b), 0), fav: theirs.reduce((a, b) => a + b.favoriters.length, 0) };
  return (
    <div className="space-y-3 build-enter">
      <div className="flex items-center gap-3 p-3 border border-[#222a3b] bg-[#12151e]">
        <div className="w-11 h-11 flex items-center justify-center border-2 border-cyan-500/60 bg-cyan-950/40 text-cyan-300"><PixelIcon name="user" className="w-7 h-7" /></div>
        <div className="min-w-0">
          <div className="text-lg font-bold text-slate-100">{author}</div>
          <div className="text-slate-400">{totals.builds} public flow{totals.builds === 1 ? '' : 's'} · <span className="text-emerald-300">{totals.up} upvotes</span> · <span className="text-pink-300">{totals.fav} favourites</span></div>
        </div>
      </div>
      {theirs.length
        ? <div className={GRID}>{theirs.map((b) => <BuildCard key={b.id} b={b} user={user} actions={actions} onView={onView} />)}</div>
        : <div className="p-6 border border-[#222a3b] text-center text-slate-500 italic">No public flows.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- detail
function BuildDetail({ build: b, user, actions, focusComments, own, onOpen, onView, onExport, onNeedLogin, onError, onDeleted, onAuthor, onReport }: {
  build: Build; user: User | null; actions: Actions; focusComments?: boolean; own?: boolean; onOpen: (b: Build) => void; onView: (b: Build) => void; onExport: (b: Build) => void; onAuthor: (b: Build) => void; onReport: (b: Build, comment?: BuildComment) => void;
  onNeedLogin: (reason: string) => void; onError: (m: string) => void; onDeleted: () => void;
}) {
  const a = useMemo(() => analyzeFlow(b.flow.nodes, b.flow.connections), [b.flow]);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [comments, setComments] = useState<BuildComment[]>([]);
  useEffect(() => (!communityEnabled ? undefined : subscribeComments(b.id, setComments)), [b.id]);
  useEffect(() => {
    if (focusComments) document.getElementById('build-comments')?.scrollIntoView({ block: 'start' });
  }, [focusComments]);
  const post = () => {
    if (!user) { onNeedLogin('Log in to comment.'); return; }
    addComment(b.id, comment).then(() => setComment('')).catch((e: Error) => onError(e.message));
  };
  const downloadSchematic = () => {
    getSchematic(b.id).then((f) => {
      if (!f) { onError('The schematic file is missing'); return; }
      // Only a base64 data link (the rules allow nothing else; this is a second check).
      if (!/^data:[\w.+/-]*;base64,[A-Za-z0-9+/=]+$/.test(f.dataUrl)) { onError('That schematic file looks wrong'); return; }
      const link = document.createElement('a');
      link.href = f.dataUrl;
      link.download = f.name;
      link.click();
    }).catch((e: Error) => onError(e.message));
  };
  const score = (c: BuildComment) => c.up.length - c.down.length;
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const postReply = (parent: BuildComment) => {
    if (!user) { onNeedLogin('Log in to reply.'); return; }
    addComment(b.id, reply, parent.id).then(() => { setReply(''); setReplyTo(null); }).catch((e: Error) => onError(e.message));
  };
  /** One comment: author, text, votes, and Reply (top-level only) / Report (others' comments). */
  const commentRow = (c: BuildComment) => {
    const mine = user ? (c.up.includes(user.uid) ? 1 : c.down.includes(user.uid) ? -1 : 0) : 0;
    const vote = (v: 1 | -1) => (user ? voteComment(b.id, c, v).catch((e: Error) => onError(e.message)) : onNeedLogin('Log in to vote on comments.'));
    return (
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-slate-500"><span className="text-slate-300 font-bold">{c.author}</span> · {new Date(c.createdAt).toLocaleString()}</div>
          <div className="text-slate-200 whitespace-pre-line break-words">{c.text}</div>
          <div className="flex gap-3 mt-0.5 text-[10px]">
            {!c.parentId && <button onClick={() => (user ? setReplyTo(replyTo === c.id ? null : c.id) : onNeedLogin('Log in to reply.'))} className="text-slate-400 hover:text-cyan-300 font-bold">Reply</button>}
            {user?.uid !== c.authorId && <button onClick={() => onReport(b, c)} className="text-rose-400/80 hover:text-rose-300 font-bold">Report</button>}
          </div>
        </div>
        <span className="inline-flex items-start gap-1 whitespace-nowrap">
          <button onClick={() => void vote(1)} className={`px-1 border ${mine === 1 ? 'border-emerald-400 text-emerald-300 bg-emerald-950' : 'border-[#2b3548] text-slate-400 hover:text-emerald-300'}`} data-tip="Upvote">
            <PixelIcon name="up" className="w-2.5 h-[6px]" /> {c.up.length}
          </button>
          <button onClick={() => void vote(-1)} className={`px-1 border ${mine === -1 ? 'border-rose-400 text-rose-300 bg-rose-950' : 'border-[#2b3548] text-slate-400 hover:text-rose-300'}`} data-tip="Downvote">
            <PixelIcon name="down" className="w-2.5 h-[6px]" /> {c.down.length}
          </button>
        </span>
      </div>
    );
  };
  const panel = (title: string, tone: string, rows: { item: { id: string; name: string; unit: 'mB' | 'item'; iconColor?: string }; perSec: number }[], empty: string) => (
    <div className="border border-[#222a3b] bg-[#12151e] p-2 space-y-1 min-w-0">
      <div className={`text-[11px] uppercase font-bold tracking-wider ${tone}`}>{title}</div>
      {rows.length ? rows.map((r) => (
        <div key={r.item.id} className="flex items-center gap-1.5">
          <ItemIcon id={r.item.id} color={r.item.iconColor} size={14} />
          <span className="text-slate-200 flex-1 min-w-0 break-words">{r.item.name}</span>
          <span className={`font-bold whitespace-nowrap ${tone}`}>{formatRate(r.perSec, r.item.unit)}</span>
        </div>
      )) : <div className="text-slate-500 italic">{empty}</div>}
    </div>
  );
  return (
    <div key={b.id} className="space-y-3 build-enter">
      {editing && <EditDetailsModal build={b} onClose={() => setEditing(false)} onError={onError} />}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1 basis-full md:basis-0">
          <div className="text-xl font-bold text-slate-100 break-words">{b.name}</div>
          <div className="text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
            <span>by {b.example ? <span className="text-slate-200 font-bold">{b.author}</span> : (
              <button onClick={() => onAuthor(b)} className="text-cyan-300 font-bold hover:underline" data-tip={`See all of ${b.author}'s public flows`}>{b.author}</button>
            )}</span>
            <span className="text-slate-600">·</span><span>{fmtDate(b.createdAt)}</span>
            <span className="text-slate-600">·</span><span><span className="text-slate-100 font-bold">{b.stats.machines}</span> machines</span>
            <span className="text-slate-600">·</span><span>tiers <TierText t={b.stats.lowTier} />–<TierText t={b.stats.topTier} /></span>
            <span className="flex items-center gap-x-2 whitespace-nowrap max-md:basis-full max-md:text-[11px]"><StatChips stats={b.stats} /></span>
          </div>
          {b.description && <p className="mt-1.5 text-slate-300 whitespace-pre-line">{b.description}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <UpvoteButton build={b} user={user} onVote={() => actions.upvote(b)} />
          <FavButton build={b} user={user} onFav={() => actions.fav(b)} />
          <CopyCount b={b} />
          <button onClick={() => onView(b)} className="px-2 py-0.5 border border-cyan-600/60 text-cyan-300 hover:bg-cyan-950 font-bold" data-tip="Look at it on the canvas (nothing is saved or changed)">Open flow</button>
          <button onClick={() => onOpen(b)} className="px-2 py-0.5 border border-emerald-600/60 text-emerald-300 hover:bg-emerald-950 font-bold" data-tip={own ? 'Open your own flow to change it' : 'Save your own copy and open it to change'}>{own ? 'Edit your flow' : 'Create copy'}</button>
          <button
            onClick={() => { navigator.clipboard.writeText(flowLink(b.id)).then(() => onError('Link copied: anyone with it can view this flow'), () => onError(flowLink(b.id))); }}
            className="px-2 py-0.5 border border-cyan-600/60 text-cyan-300 hover:bg-cyan-950 inline-flex items-center gap-1"
            data-tip="Copy a link that opens this flow"
          >
            <Link2 className="w-3 h-3" /> Copy link
          </button>
          <button onClick={() => onExport(b)} className="px-2 py-0.5 border border-sky-700/50 text-sky-300 hover:bg-sky-950 inline-flex items-center gap-1"><Download className="w-3 h-3" /> .json</button>
          {user?.uid !== b.authorId && (
            <button onClick={() => onReport(b)} className="px-2 py-0.5 border border-rose-600/70 bg-rose-950/60 text-rose-300 hover:bg-rose-900 font-bold inline-flex items-center gap-1" data-tip="Report this flow to the moderators">
              <Flag className="w-3 h-3" /> Report
            </button>
          )}
          {b.schematicName && <button onClick={downloadSchematic} className="px-2 py-0.5 border border-violet-600/60 text-violet-300 hover:bg-violet-950 inline-flex items-center gap-1" data-tip="The author's schematic file"><Download className="w-3 h-3" /> {b.schematicName}</button>}
          {user?.uid === b.authorId && !b.example && (
            <button onClick={() => setEditing(true)} className="px-2 py-0.5 border border-amber-600/60 text-amber-300 hover:bg-amber-950 inline-flex items-center gap-1" data-tip="Change the name, description or tag (votes, comments and the link stay)"><Pencil className="w-3 h-3" /> Edit details</button>
          )}
          {user?.uid === b.authorId && (
            <button onClick={() => { if (window.confirm(`Delete "${b.name}" from Community?`)) deleteBuild(b.id).then(onDeleted).catch((e: Error) => onError(e.message)); }} className="px-2 py-0.5 border border-rose-700/50 text-rose-300 hover:bg-rose-950 inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
          )}
        </div>
      </div>

      <SimpleTree build={b} machines={a.machines} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {panel('Inputs (you supply)', 'text-rose-300', a.inputs, 'Nothing: it supplies itself.')}
        {panel('Surplus (by-products)', 'text-cyan-300', a.surplus, 'No surplus.')}
        <div className="space-y-1 min-w-0">
          {panel('Output (target)', 'text-emerald-300', a.output ? [a.output] : [], 'No target set.')}
          {a.output && a.outputUsed > 1e-9 && (
            <div className="text-[11px] text-slate-400 px-1">
              {formatRate(a.outputUsed, a.output.item.unit)} of it is used inside the flow{b.flow.nodes.some((n) => n.recipe.generatesEU) ? ' (burnt by its generators)' : ''}; {formatRate(Math.max(0, a.output.perSec - a.outputUsed), a.output.item.unit)} left over.
            </div>
          )}
        </div>
      </div>

      {communityEnabled && (
        <div id="build-comments" className="border border-[#222a3b] bg-[#12151e] p-3 space-y-2">
          <div className="text-[11px] uppercase font-bold tracking-wider text-slate-300">Comments ({comments.length})</div>
          {/* Top-level comments by score; replies under each, oldest first. */}
          {[...comments].filter((c) => !c.parentId).sort((x, y) => score(y) - score(x) || x.createdAt - y.createdAt).map((c) => (
            <div key={c.id} className="border-t border-[#1d2433] pt-2 space-y-1.5">
              {commentRow(c)}
              {comments.filter((r) => r.parentId === c.id).sort((x, y) => x.createdAt - y.createdAt).map((r) => (
                <div key={r.id} className="ml-5 pl-2 border-l-2 border-[#2b3548]">{commentRow(r)}</div>
              ))}
              {replyTo === c.id && (
                <div className="ml-5 flex gap-1.5">
                  <textarea autoFocus value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} rows={2} placeholder={`Reply to ${c.author}`} className="flex-1 bg-[#0f131c] border border-[#2b3548] px-2 py-1 text-slate-200 outline-none focus:border-cyan-400 resize-y" />
                  <div className="flex flex-col gap-1">
                    <button onClick={() => postReply(c)} disabled={!reply.trim()} className="px-3 py-0.5 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-950 font-bold disabled:opacity-40">Reply</button>
                    <button onClick={() => { setReplyTo(null); setReply(''); }} className="px-3 py-0.5 border border-[#2b3548] text-slate-400 hover:bg-[#202737]">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-1.5 pt-1">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onFocus={() => { if (!user) onNeedLogin('Log in to comment.'); }}
              maxLength={1000}
              rows={2}
              placeholder={user ? 'Add a comment' : 'Log in to comment'}
              className="flex-1 bg-[#0f131c] border border-[#2b3548] px-2 py-1 text-slate-200 outline-none focus:border-cyan-400 resize-y"
            />
            <button onClick={post} disabled={!comment.trim()} className="px-3 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-950 font-bold disabled:opacity-40">Post</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The build laid out as it is on its canvas (same positions and card widths), drawn smaller,
 * with straight right-angled wires like the canvas. No animation; text is clipped to each card.
 */
/** The author changes a shared flow's name, description and tag in place. */
function EditDetailsModal({ build, onClose, onError }: { build: Build; onClose: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(build.name);
  const [description, setDescription] = useState(build.description ?? '');
  const [tag, setTag] = useState<FlowTag | ''>(build.tag ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setBusy(true);
    updateBuildDetails(build, { name, description, ...(tag ? { tag } : {}) })
      .then(() => { onError('Flow details updated'); onClose(); })
      .catch((e: Error) => { setError(e.message); setBusy(false); });
  };
  const field = 'w-full bg-[#12151e] border border-[#2b3548] px-2 py-1.5 text-slate-100 outline-none focus:border-cyan-400';
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-[460px] max-w-full bg-[#161a24] border border-[#2b3548] shadow-2xl p-4 space-y-3 text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-bold text-sm text-slate-100">Edit shared flow</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" data-tip="Close" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <label className="block space-y-1">
          <span className="text-slate-400">Name</span>
          <input autoFocus value={name} maxLength={64} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="block space-y-1">
          <span className="text-slate-400">Description</span>
          <textarea value={description} maxLength={2000} rows={4} onChange={(e) => setDescription(e.target.value)} className={`${field} resize-y`} />
        </label>
        <label className="block space-y-1">
          <span className="text-slate-400">Tag</span>
          <select value={tag} onChange={(e) => setTag(e.target.value as FlowTag | '')} className={field}>
            <option value="">No tag</option>
            {FLOW_TAGS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <p className="text-slate-500">To change the flow itself, open it with Edit your flow, then use Update shared in My flows.</p>
        {error && <div className="text-rose-300 font-bold">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 border border-[#2b3548] text-slate-300 font-bold hover:bg-[#202737]">Cancel</button>
          <button onClick={save} disabled={busy || !name.trim()} className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 font-bold disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  );
}

function SimpleTree({ build, machines }: { build: Build; machines: Map<string, number> }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1); // on top of the fitted scale
  // Scroll to zoom around the pointer (a non-passive listener, so the page doesn't scroll too),
  // drag to pan. The point under the pointer stays put while zooming.
  const scaleRef = useRef(1);
  const anchor = useRef<{ x: number; y: number; mx: number; my: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      anchor.current = { x: (el.scrollLeft + mx) / scaleRef.current, y: (el.scrollTop + my) / scaleRef.current, mx, my };
      setZoom((z) => Math.min(4, Math.max(0.25, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const startDrag = (e: React.MouseEvent) => {
    const el = box.current;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest('button,a')) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setDragging(true);
    const move = (ev: MouseEvent) => { el.scrollLeft = start.left - (ev.clientX - start.x); el.scrollTop = start.top - (ev.clientY - start.y); };
    const up = () => { setDragging(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const HEAD = 62, ROW = 28, PAD = 8, PORT_W = 6;
  const nodes = build.flow.nodes;
  const cards = useMemo(() => {
    const map = new Map<string, { x: number; y: number; w: number; h: number; ins: string[]; outs: string[] }>();
    for (const n of nodes) {
      const supply = n.recipe.kind === 'supply';
      const w = supply || n.recipe.kind === 'output' ? SUPPLY_WIDTH : n.multi || (n.gen && n.gen.kind !== 'single') ? NODE_WIDE : NODE_WIDTH;
      const ins = supply ? [] : [...n.recipe.inputs.filter((i) => i.consumed !== false).map((i) => i.id), ...(n.gen?.extras ?? []).map((x) => x.id)];
      const outs = n.recipe.outputs.map((o) => o.id);
      const rows = Math.max(ins.length, outs.length, 1);
      map.set(n.instanceId, { x: n.x, y: n.y, w, h: HEAD + rows * ROW + PAD, ins, outs });
    }
    // Real cards are taller than these previews, so their gaps are too. Squeeze the vertical
    // spacing as far as possible without any two previews overlapping.
    const list = [...map.values()];
    const top = Math.min(...list.map((c) => c.y));
    const fits = (k: number) => {
      const ys = list.map((c) => top + (c.y - top) * k);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.x < b.x + b.w + 20 && b.x < a.x + a.w + 20 && ys[i] < ys[j] + b.h + 16 && ys[j] < ys[i] + a.h + 16) return false;
      }
      return true;
    };
    let k = 1;
    for (let t = 0.3; t < 1; t += 0.05) if (fits(t)) { k = t; break; }
    for (const c of list) c.y = top + (c.y - top) * k;
    return map;
  }, [nodes]);
  const all = [...cards.values()];
  const minX = all.length ? Math.min(...all.map((c) => c.x)) - 40 : 0;
  const minY = all.length ? Math.min(...all.map((c) => c.y)) - 30 : 0;
  const maxX = all.length ? Math.max(...all.map((c) => c.x + c.w)) + 40 : 1;
  const maxY = all.length ? Math.max(...all.map((c) => c.y + c.h)) + 30 : 1;
  const W = maxX - minX, H = maxY - minY;
  // 100% is a readable card size (not fitted to the box); the box keeps its height and scrolls.
  const BASE_SCALE = 0.8;
  const scale = BASE_SCALE * zoom;
  // Open where the flow starts: the top of its left-most column.
  const leftX = all.length ? Math.min(...all.map((c) => c.x)) : 0;
  const startY = all.length ? Math.min(...all.filter((c) => c.x <= leftX + 60).map((c) => c.y)) : 0;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollLeft = 0;
    el.scrollTop = Math.max(0, (startY - minY - 20) * BASE_SCALE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build.id]);
  // After a wheel zoom, scroll so the point that was under the pointer still is.
  useLayoutEffect(() => {
    scaleRef.current = scale;
    const a = anchor.current, el = box.current;
    if (!a || !el) return;
    anchor.current = null;
    el.scrollLeft = a.x * scale - a.mx;
    el.scrollTop = a.y * scale - a.my;
  }, [scale]);
  if (!all.length) return null;
  const zoomBy = (k: number) => setZoom((z) => Math.min(4, Math.max(0.25, Math.round(z * k * 100) / 100)));
  const zbtn = 'w-7 h-7 flex items-center justify-center border border-[#2b3548] bg-[#161a24]/95 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/60';
  const portY = (c: { y: number }, i: number) => c.y + HEAD + i * ROW + ROW / 2 - 2;
  const byId = new Map(nodes.map((n) => [n.instanceId, n]));
  const itemName = (n: CanvasNode, id: string, side: 'in' | 'out') =>
    (side === 'in' ? [...n.recipe.inputs, ...(n.gen?.extras ?? [])] : n.recipe.outputs).find((i) => i.id === id);

  return (
    <div className="relative">
    <div className="absolute right-2 top-2 z-10 flex items-center gap-1 text-[11px]">
      <button onClick={() => zoomBy(1 / 1.25)} className={zbtn} data-tip="Zoom out" aria-label="Zoom out"><Minus className="w-3.5 h-3.5" /></button>
      <button onClick={() => setZoom(1)} className={`${zbtn} !w-auto px-1.5 font-bold`} data-tip="Fit">{Math.round(zoom * 100)}%</button>
      <button onClick={() => zoomBy(1.25)} className={zbtn} data-tip="Zoom in" aria-label="Zoom in"><Plus className="w-3.5 h-3.5" /></button>
    </div>
    <div
      ref={box}
      className={`border border-[#222a3b] bg-[#0f131c] overflow-auto select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ height: Math.min(560, H * BASE_SCALE + 4) }} // set by the 100% size, so zooming never resizes the box
      onMouseDown={startDrag}
    >
      <div style={{ width: W * scale, height: H * scale, position: 'relative' }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          <svg className="absolute inset-0 pointer-events-none" width={W} height={H}>
            {build.flow.connections.map((c) => {
              const s = cards.get(c.sourceInstanceId), t = cards.get(c.targetInstanceId);
              const sn = byId.get(c.sourceInstanceId);
              if (!s || !t || !sn) return null;
              const x1 = s.x + s.w + PORT_W - minX, y1 = portY(s, Math.max(0, s.outs.indexOf(c.sourceItemId))) - minY;
              const x2 = t.x - PORT_W - minX, y2 = portY(t, Math.max(0, t.ins.indexOf(c.targetItemId))) - minY;
              // Forward: across, down, across. Backward: out, round below the lower card, back in.
              let d: string;
              if (x2 > x1 + 30) {
                const mx = Math.round((x1 + x2) / 2);
                d = `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`;
              } else {
                const below = Math.max(s.y + s.h, t.y + t.h) - minY + 20;
                d = `M ${x1} ${y1} H ${x1 + 20} V ${below} H ${x2 - 20} V ${y2} H ${x2}`;
              }
              const color = itemName(sn, c.sourceItemId, 'out')?.iconColor ?? '#64748b';
              return (
                <g key={c.id}>
                  <path d={d} stroke="#0b0f17" strokeWidth={6} fill="none" />
                  <path d={d} stroke={color} strokeWidth={3} fill="none" />
                </g>
              );
            })}
          </svg>
          {nodes.map((n) => {
            const c = cards.get(n.instanceId)!;
            const supply = n.recipe.kind === 'supply';
            const sink = n.recipe.kind === 'output';
            const name = supply ? 'Input' : sink ? `Output: ${n.recipe.recipeName}` : n.multi?.name ?? (n.gen && n.gen.kind !== 'single' ? n.gen.name : n.recipe.machineName);
            const count = machines.get(n.instanceId);
            const border = n.isTarget || sink ? '#22d3ee' : supply ? '#10b981' : n.recipe.generatesEU ? '#f59e0b' : '#3b4a63';
            const port = (id: string, side: 'in' | 'out', i: number) => {
              const it = itemName(n, id, side);
              return (
                <div key={`${side}${i}`} className="relative flex items-center gap-1.5 px-1.5 border border-[#2b3548] bg-[#121620] min-w-0" style={{ height: ROW - 4, marginBottom: 4 }}>
                  <span className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-3 ${side === 'in' ? '-left-[8px]' : '-right-[8px]'}`} style={{ background: it?.iconColor ?? '#64748b' }} />
                  <span className="w-3 h-3 flex-shrink-0" style={{ background: it?.iconColor ?? '#64748b' }} />
                  <span className="truncate text-[12px] text-slate-200" data-tip-cut="" data-tip={it?.name ?? id}>{it?.name ?? id}</span>
                </div>
              );
            };
            return (
              <div key={n.instanceId} className="absolute border-[3px] overflow-hidden" style={{ left: c.x - minX, top: c.y - minY, width: c.w, height: c.h, borderColor: border, background: n.isTarget ? 'rgba(18,50,74,0.97)' : 'rgba(22,26,36,0.97)' }}>
                <div className="px-2 pt-1.5" style={{ height: HEAD - 6 }}>
                  <div className="font-bold text-[15px] text-slate-100 truncate" data-tip-cut="" data-tip={supply ? `Input: ${n.recipe.recipeName}` : name}>{supply ? `Input: ${n.recipe.recipeName}` : name}</div>
                  <div className="text-[12px] text-slate-400 truncate" data-tip-cut="" data-tip={supply ? 'You supply this' : sink ? 'What this line makes' : `${count != null ? `${Math.round(count)}× ` : ''}${n.selectedTier} · ${n.recipe.recipeName}`}>
                    {supply ? 'You supply this' : sink ? 'What this line makes' : `${count != null ? `${Math.round(count)}× ` : ''}${n.selectedTier} · ${n.recipe.recipeName}`}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 px-2">
                  <div className="min-w-0">{c.ins.map((id, i) => port(id, 'in', i))}</div>
                  <div className="min-w-0">{c.outs.map((id, i) => port(id, 'out', i))}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}
