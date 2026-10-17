import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';
import { changePassword, communityEnabled, deleteAccount, logout, setRecoveryEmail, subscribeBuilds, upvotes, type Build, type User } from '../community';
import { PixelIcon } from './PixelIcon';
import { UnitsSetting } from './UnitsPicker';

/**
 * Profile window: the flow you have open, shortcuts to all your flows and a new one, account
 * settings and log out. Works logged out too (saves live in the browser), with a log-in prompt.
 */
export interface Activity { build: Build; up: number; fav: number; comments: number; copies: number; total: number }

export function ProfileModal({ user, pack, currentFlow, pixelFont, onPixelFont, onClose, onOpenYourBuilds, onNewFlow, onModeration, onLogin, onError, activity = [], onSeen, onOpenActivity }: {
  activity?: Activity[]; // new upvotes, favourites, comments and copies since last time
  onSeen?: () => void; // "Mark all read"
  onOpenActivity?: (a: Activity) => void; // open that flow's page (clears its news)
  user: User | null;
  pack: string;
  currentFlow: ReactNode; // the open flow's entry from the saves list
  pixelFont: boolean; // the blocky font everywhere
  onPixelFont: (on: boolean) => void;
  onClose: () => void;
  onOpenYourBuilds: () => void;
  onNewFlow: () => void;
  onModeration?: () => void; // moderators only
  onLogin: () => void;
  onError: (m: string) => void;
}) {
  const [builds, setBuilds] = useState<Build[]>([]);

  useEffect(() => (user && communityEnabled ? subscribeBuilds(pack, setBuilds, (e) => onError(e.message)) : undefined), [pack, onError, user]);
  const mine = user ? builds.filter((b) => b.authorId === user.uid) : [];
  const stats = user ? [
    ['Flows\nshared', mine.length],
    ['Upvotes received', mine.reduce((a, b) => a + upvotes(b), 0)],
    ['Favourited by others', mine.reduce((a, b) => a + b.favoriters.length, 0)],
    ['My\nfavourites', builds.filter((b) => b.favoriters.includes(user.uid)).length],
  ] as const : [];

  const [form, setForm] = useState<'password' | 'email' | null>(null);
  // Deleting the account: 'warn' (what goes), then 'type' (type DELETE to confirm).
  const [deleting, setDeleting] = useState<'warn' | 'type' | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const removeAccount = async () => {
    setBusy(true);
    try { await deleteAccount(); onClose(); onError('Your account and everything in it has been deleted'); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      if (form === 'password') {
        if (next.length < 6) throw new Error('New password: at least 6 characters');
        await changePassword(current, next);
        setMsg({ ok: true, text: 'Password changed' });
      } else {
        await setRecoveryEmail(current, next);
        setMsg({ ok: true, text: `Check ${next} for a link to confirm it. After that, log in with that email.` });
      }
      setForm(null);
      setCurrent('');
      setNext('');
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  const input = 'w-full bg-[#12151e] border border-[#2b3548] px-2 py-1.5 text-slate-100 outline-none focus:border-cyan-400';

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-[480px] max-w-full max-h-[88vh] overflow-y-auto bg-[#161a24] border border-[#2b3548] shadow-2xl text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-[#283244]">
          <div className={`w-12 h-12 flex items-center justify-center border-2 ${user ? 'border-emerald-500/60 bg-emerald-950/50 text-emerald-300' : 'border-[#3a4560] bg-[#12151e] text-slate-400'}`}>
            <PixelIcon name="user" className="w-8 h-8" />
          </div>
          <div className="min-w-0 flex-1">
            {user ? (
              <>
                <div className="text-base font-bold text-slate-100">{user.username}</div>
                <div className="text-slate-500">Member since {new Date(user.createdAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                <div className="text-slate-500">{user.google ? <>Google account{user.email ? <> · <span className="text-slate-300">{user.email}</span></> : null}</> : user.email ? <>Email: <span className="text-slate-300">{user.email}</span></> : 'No email: password resets need one'}</div>
              </>
            ) : (
              <>
                <div className="text-base font-bold text-slate-100">Guest</div>
                <div className="text-slate-500">Your flows are saved in this browser. Log in to keep them on any device and to share them.</div>
              </>
            )}
          </div>
          <button onClick={onClose} className="self-start text-slate-400 hover:text-slate-100" data-tip="Close"><X className="w-4 h-4" /></button>
        </div>

        {user && (
          <div className="grid grid-cols-4 gap-1.5 p-4 pb-2">
            {stats.map(([label, value]) => (
              <div key={label} className="border border-[#222a3b] bg-[#12151e] p-2 text-center">
                <div className="text-lg font-bold text-slate-100">{value}</div>
                <div className="text-[10px] text-slate-500 leading-tight whitespace-pre-line">{label}</div>
              </div>
            ))}
          </div>
        )}

        {activity.length > 0 && (
          <div className="px-4 py-2 space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-[11px] uppercase font-bold tracking-wider text-rose-300 flex-1">New on your flows</div>
              {onSeen && <button onClick={onSeen} className="text-[10px] text-slate-400 hover:text-slate-100 font-bold">Mark all read</button>}
            </div>
            {activity.map((a) => {
              const bits = [a.up && `${a.up} upvote${a.up === 1 ? '' : 's'}`, a.fav && `${a.fav} favourite${a.fav === 1 ? '' : 's'}`, a.comments && `${a.comments} comment${a.comments === 1 ? '' : 's'}`, a.copies && `${a.copies} cop${a.copies === 1 ? 'y' : 'ies'}`].filter(Boolean);
              return (
                <button key={a.build.id} onClick={() => onOpenActivity?.(a)} className="w-full text-left flex items-baseline gap-2 border border-rose-900/50 bg-rose-950/20 hover:bg-rose-950/50 hover:border-rose-700/70 px-2 py-1" data-tip={a.comments ? 'Open the flow at its comments' : 'Open the flow'}>
                  <span className="text-slate-100 font-bold truncate flex-1">{a.build.name}</span>
                  <span className="text-[10px] text-rose-200 whitespace-nowrap">+{bits.join(', +')}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="px-4 py-2 space-y-1.5">
          <div className="text-[11px] uppercase font-bold tracking-wider text-slate-300">Current flow</div>
          {currentFlow}
          <div className="flex gap-1.5">
            <button onClick={onOpenYourBuilds} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 border border-cyan-600/60 text-cyan-300 hover:bg-cyan-950 font-bold">Open all my flows <ArrowRight className="w-3.5 h-3.5" /></button>
            <button onClick={onNewFlow} className="inline-flex items-center gap-1 px-2 py-1 border border-emerald-600/60 text-emerald-300 hover:bg-emerald-950 font-bold" data-tip="Start a new, empty flow (undo-able)"><Plus className="w-3.5 h-3.5" /> New flow</button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2 border-t border-[#283244] mt-2">
          <div className="text-[11px] uppercase font-bold tracking-wider text-slate-300">Customise</div>
          {/* Amounts, power and font on one row */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <UnitsSetting />
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Font</div>
              <div className="flex h-7">
                {([[true, 'AA', 'Pixel', 'font-pixel-bold'], [false, 'Aa', 'Monospace', 'font-mono']] as const).map(([on, sample, label, cls]) => (
                  <button key={label} onClick={() => onPixelFont(on)} data-tip={label} className={`w-9 border font-bold ${cls} ${pixelFont === on ? 'border-cyan-400 bg-cyan-950 text-cyan-100' : 'border-[#2b3548] text-slate-400 hover:text-slate-200 hover:bg-[#202737]'}`}>{sample}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2 border-t border-[#283244]">
          <div className="text-[11px] uppercase font-bold tracking-wider text-slate-300">Account</div>
          {user ? (
            <div className="flex gap-1.5 flex-wrap">
              {!user.google && <button onClick={() => { setForm(form === 'password' ? null : 'password'); setMsg(null); }} className={`px-2.5 py-1 border font-bold ${form === 'password' ? 'border-cyan-400 text-cyan-300 bg-cyan-950' : 'border-[#2b3548] text-slate-300 hover:bg-[#202737]'}`}>Change password</button>}
              {!user.google && <button onClick={() => { setForm(form === 'email' ? null : 'email'); setMsg(null); }} className={`px-2.5 py-1 border font-bold ${form === 'email' ? 'border-cyan-400 text-cyan-300 bg-cyan-950' : 'border-[#2b3548] text-slate-300 hover:bg-[#202737]'}`}>{user.email ? 'Change email' : 'Add email for resets'}</button>}
              {onModeration && <button onClick={onModeration} className="px-2.5 py-1 border border-amber-500/60 text-amber-300 hover:bg-amber-950 font-bold">Moderation</button>}
              {!deleting && <button onClick={() => setDeleting('warn')} className="ml-auto px-2.5 py-1 border border-rose-600/70 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 hover:text-rose-100 font-bold">Delete my account…</button>}
            </div>
          ) : (
            <button onClick={onLogin} className="px-3 py-1 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-950 font-bold">Log in or sign up</button>
          )}
          {user && (
            <div className="pt-1">
              {!deleting && <button onClick={() => { void logout(); onClose(); }} className="w-full px-2.5 py-1.5 border border-rose-600/60 text-rose-300 hover:bg-rose-950 font-bold">Log out</button>}
              {deleting && (
                <div className="p-2.5 border border-rose-600/70 bg-rose-950/30 space-y-2">
                  <div className="font-bold text-rose-200">Delete your account?</div>
                  <div className="text-rose-100/90 leading-relaxed">This permanently deletes everything linked to {user.username}: every flow you've shared (with its comments and files), your comments on other flows, your votes and favourites, the flows saved to your account, and your username. It can't be undone. Flows saved only in this browser stay here.</div>
                  {deleting === 'warn' ? (
                    <div className="flex gap-1.5 justify-end">
                      <button onClick={() => setDeleting(null)} className="px-2.5 py-1 border border-[#2b3548] text-slate-300 hover:bg-[#202737] font-bold">Cancel</button>
                      <button onClick={() => { setDeleting('type'); setTyped(''); }} className="px-2.5 py-1 border border-rose-500 bg-rose-900/60 text-rose-100 hover:bg-rose-800 font-bold">Confirm</button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="block text-rose-100/90">Type <b>DELETE</b> to delete your account:</label>
                      <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className={input} />
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => setDeleting(null)} className="px-2.5 py-1 border border-[#2b3548] text-slate-300 hover:bg-[#202737] font-bold">Cancel</button>
                        <button disabled={typed !== 'DELETE' || busy} onClick={() => void removeAccount()} className="px-2.5 py-1 border border-rose-500 bg-rose-700 text-white hover:bg-rose-600 font-bold disabled:opacity-40">{busy ? 'Deleting…' : 'Delete everything'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {form && (
            <form onSubmit={submit} className="space-y-1.5 p-2 border border-[#222a3b] bg-[#12151e]">
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" className={input} />
              <input
                type={form === 'password' ? 'password' : 'email'}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder={form === 'password' ? 'New password (6+ characters)' : 'Email address'}
                autoComplete={form === 'password' ? 'new-password' : 'email'}
                className={input}
              />
              <button type="submit" disabled={!current || !next} className="px-3 py-1 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-950 font-bold disabled:opacity-40">Save</button>
            </form>
          )}
          {msg && <div className={msg.ok ? 'text-emerald-300' : 'text-rose-300 font-bold'}>{msg.text}</div>}
        </div>
      </div>
    </div>
  );
}
