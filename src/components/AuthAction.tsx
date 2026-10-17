import { useEffect, useState } from 'react';
import { applyActionCode, checkActionCode, confirmPasswordReset, sendPasswordResetEmail, verifyPasswordResetCode } from 'firebase/auth';
import { fb } from '../firebase';

/**
 * Landing page for the links in account emails (/auth/action?mode=...&oobCode=...).
 * Firebase's own page lives on firebaseapp.com; this one keeps the link on gtcalc.app,
 * which spam filters like, and matches the site.
 */
type State =
  | { step: 'loading' }
  | { step: 'reset'; email: string }
  | { step: 'done'; title: string; text: string }
  | { step: 'error'; text: string };

const ERRORS: Record<string, string> = {
  'auth/expired-action-code': 'This link has expired. Ask for a new one from the sign-in box on gtcalc.',
  'auth/invalid-action-code': 'This link has already been used or isn\'t valid. Ask for a new one from the sign-in box on gtcalc.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'There\'s no account for this link any more.',
  'auth/weak-password': 'Password: at least 6 characters.',
};
const message = (e: unknown) => ERRORS[(e as { code?: string }).code ?? ''] ?? 'Something went wrong. Try the link again, or ask for a new one.';

export default function AuthAction() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const code = params.get('oobCode') ?? '';
  const [state, setState] = useState<State>(() => {
    try { fb(); } catch { return { step: 'error', text: 'Accounts aren\'t available right now.' }; }
    return code ? { step: 'loading' } : { step: 'error', text: 'This link is missing its code. Open it straight from the email.' };
  });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    document.title = 'gtcalc account';
    if (state.step !== 'loading') return;
    const { auth } = fb();
    (async () => {
      try {
        if (mode === 'resetPassword') {
          setState({ step: 'reset', email: await verifyPasswordResetCode(auth, code) });
        } else if (mode === 'verifyEmail' || mode === 'verifyAndChangeEmail') {
          await applyActionCode(auth, code);
          setState({ step: 'done', title: 'Email confirmed', text: mode === 'verifyEmail' ? 'Thanks, your email address is confirmed.' : 'Your sign-in email has been changed.' });
        } else if (mode === 'recoverEmail') {
          const info = await checkActionCode(auth, code);
          await applyActionCode(auth, code);
          const restored = info.data.email ?? '';
          let extra = '';
          if (restored) {
            try { await sendPasswordResetEmail(auth, restored); extra = ` We've also sent a password reset link to ${restored}, in case someone else changed it.`; } catch { /* the restore still worked */ }
          }
          setState({ step: 'done', title: 'Email restored', text: `Your sign-in email is back to ${restored || 'what it was'}.${extra}` });
        } else {
          setState({ step: 'error', text: 'This link isn\'t one gtcalc understands.' });
        }
      } catch (e) {
        setState({ step: 'error', text: message(e) });
      }
    })();
    // Runs once on load: an action code only works once.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { setFormError('Password: at least 6 characters.'); return; }
    if (password !== again) { setFormError('The two passwords don\'t match.'); return; }
    setBusy(true); setFormError('');
    try {
      await confirmPasswordReset(fb().auth, code, password);
      setState({ step: 'done', title: 'Password changed', text: 'You can log in with your new password now.' });
    } catch (err) {
      setFormError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full bg-[#12151e] border border-[#2b3548] px-2.5 py-2 text-sm text-slate-200 focus:border-cyan-400 outline-none select-text';
  return (
    <div className="pixel-font-all blueprint-grid min-h-screen flex items-center justify-center p-4 select-text">
      <div className="w-full max-w-md">
        <a href="/" className="flex items-center gap-3 mb-4 no-underline">
          <img src="/favicon.svg" alt="" width={40} height={40} style={{ imageRendering: 'pixelated' }} />
          <span className="font-pixel-bold text-cyan-400 text-2xl">gtcalc</span>
        </a>
        <div className="border-[3px] border-cyan-400 bg-[#161a24] shadow-[0_0_32px_rgba(6,182,212,0.35)]">
          <div className="px-4 py-2 bg-[rgba(22,78,99,0.5)] border-b border-cyan-400/60 font-pixel-bold text-[11px] text-cyan-200 uppercase tracking-wider">
            Account
          </div>
          <div className="p-5 space-y-4 text-sm text-slate-300">
            {state.step === 'loading' && <p className="text-slate-400">Checking the link…</p>}

            {state.step === 'reset' && (
              <form onSubmit={submitReset} className="space-y-3">
                <h1 className="font-pixel-bold text-lg text-slate-100">New password</h1>
                <p>For <span className="text-cyan-300 break-all">{state.email}</span></p>
                <input type="email" value={state.email} autoComplete="username" readOnly hidden />
                <input type="password" className={input} placeholder="New password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                <input type="password" className={input} placeholder="Type it again" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
                {formError && <p className="text-rose-400 text-xs">{formError}</p>}
                <button type="submit" disabled={busy} className="w-full py-2 bg-cyan-900/60 hover:bg-cyan-800/70 border border-cyan-400 text-cyan-100 font-pixel-bold uppercase text-sm disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save password'}
                </button>
              </form>
            )}

            {state.step === 'done' && (
              <>
                <h1 className="font-pixel-bold text-lg text-slate-100">{state.title}</h1>
                <p>{state.text}</p>
                <a href="/" className="block text-center py-2 bg-cyan-900/60 hover:bg-cyan-800/70 border border-cyan-400 text-cyan-100 font-pixel-bold uppercase text-sm no-underline">Open gtcalc</a>
              </>
            )}

            {state.step === 'error' && (
              <>
                <h1 className="font-pixel-bold text-lg text-rose-300">Link not working</h1>
                <p>{state.text}</p>
                <a href="/" className="block text-center py-2 bg-[#1e2535] hover:bg-[#283246] border border-[#2d3a52] text-slate-200 font-pixel-bold uppercase text-sm no-underline">Go to gtcalc</a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
