import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { claimUsername, communityEnabled, login, loginWithGoogle, register, renameUsername, resetPassword } from '../community';
import { startAppCheck } from '../firebase';

/** Log in or make an account: username and password, with an optional email for resets. */
export function AuthModal({ reason, onDone, onClose, pickUsername, rename }: { reason?: string; onDone: () => void; onClose: () => void; pickUsername?: boolean; rename?: boolean }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'username'>(pickUsername || rename ? 'username' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // reCAPTCHA (App Check) loads while the form is filled in, not on the first visit to the site.
  useEffect(() => { if (communityEnabled) startAppCheck(); }, []);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'username') {
        await (rename ? renameUsername(username) : claimUsername(username));
        onDone();
      } else if (mode === 'reset') {
        await resetPassword(email);
        setInfo('If that email belongs to an account, a reset link is on its way.');
      } else {
        await (mode === 'login' ? login(username, password) : register(username, password, email));
        onDone();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const input = 'w-full bg-[#12151e] border border-[#2b3548] px-2 py-1.5 text-slate-100 outline-none focus:border-cyan-400';
  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onMouseDown={onClose}>
      <form onSubmit={submit} className="w-[360px] max-w-full bg-[#161a24] border border-[#2b3548] shadow-2xl p-4 space-y-3 text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className={`flex border border-[#2b3548] ${mode === 'username' ? 'invisible' : ''}`}>
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); setInfo(null); }}
                className={`px-3 py-1 font-bold ${mode === m ? 'bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-100" data-tip="Close" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {!communityEnabled && <div className="text-amber-300">The community server isn't connected in this build, so accounts are unavailable.</div>}
        {reason && <div className="text-amber-300/90">{reason}</div>}
        {mode === 'username' && (
          <>
            {rename
              ? <div className="text-amber-200 font-bold">Your username was flagged as inappropriate. Please enter a new one.</div>
              : <div className="text-slate-300">Signed in with Google. Pick the username other players will see.</div>}
            <label className="block space-y-1">
              <span className="text-slate-400">Username</span>
              <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} className={input} />
            </label>
          </>
        )}
        {(mode === 'login' || mode === 'register') && (
          <>
            <label className="block space-y-1">
              <span className="text-slate-400">{mode === 'login' ? 'Username or email' : 'Username'}</span>
              <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} maxLength={mode === 'login' ? 120 : 20} autoComplete="username" className={input} />
            </label>
            <label className="block space-y-1">
              <span className="text-slate-400">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={input} />
            </label>
          </>
        )}
        {(mode === 'register' || mode === 'reset') && (
          <label className="block space-y-1">
            <span className="text-slate-400">Email {mode === 'register' ? '(optional, only for password resets)' : ''}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={input} />
          </label>
        )}
        {error && <div className="text-rose-300 font-bold">{error}</div>}
        {info && <div className="text-emerald-300">{info}</div>}
        {(mode === 'login' || mode === 'register') && (
          <div className="text-[10px] text-slate-500">
            By signing in or creating an account you agree to the{' '}
            <a href="/terms" className="text-cyan-300 hover:underline">Terms</a> and{' '}
            <a href="/privacy" className="text-cyan-300 hover:underline">Privacy Policy</a>.
          </div>
        )}
        <button type="submit" disabled={busy || !communityEnabled || (mode === 'reset' ? !email : mode === 'username' ? !username : !username || !password)} className="w-full py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 font-bold disabled:opacity-40">
          {mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : mode === 'username' ? 'Save username' : 'Send reset link'}
        </button>
        {(mode === 'login' || mode === 'register') && (
          <button
            type="button"
            disabled={busy || !communityEnabled}
            onClick={async () => {
              setBusy(true); setError(null);
              try { await loginWithGoogle(); onDone(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
            }}
            className="w-full py-1.5 flex items-center justify-center gap-2 bg-[#1a202c] hover:bg-[#252f40] border border-[#3a4560] text-slate-100 font-bold disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" /></svg>
            Continue with Google
          </button>
        )}
        <div className="flex justify-between text-[11px]">
          {mode === 'login' && <button type="button" onClick={() => { setMode('reset'); setError(null); }} className="text-slate-400 hover:text-cyan-300">Forgot password?</button>}
          {mode === 'reset' && <button type="button" onClick={() => { setMode('login'); setError(null); setInfo(null); }} className="text-slate-400 hover:text-cyan-300">Back to log in</button>}
        </div>
        <div className="text-[10px] text-slate-500 leading-snug">
          {mode === 'reset'
            ? 'Resets only work for accounts with an email. Without one, there is no way to recover the password.'
            : 'A username and password is all you need. An email is optional and only used for password resets. No IP addresses are kept.'}
        </div>
      </form>
    </div>
  );
}
