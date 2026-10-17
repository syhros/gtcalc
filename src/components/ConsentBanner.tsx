import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { setConsent, useConsent } from '../consent';

/** Anonymous visit stats, only once the visitor has accepted them. */
export function Telemetry() {
  return useConsent() === 'accepted' ? <><Analytics /><SpeedInsights /></> : null;
}

/** First-visit banner along the bottom: what's stored, links to the policies, Accept or Reject. */
export function ConsentBanner() {
  if (useConsent() !== null) return null;
  return (
    // Sits above the energy bar (bottom right), clear of the canvas toolbar and help on the left.
    <div role="dialog" aria-label="Cookies and privacy" className="fixed right-2 left-2 bottom-12 md:left-auto md:right-3 md:bottom-14 z-[80] pointer-events-none">
      <div className="pointer-events-auto md:w-[460px] flex flex-col gap-3 px-4 py-3 bg-[#161a24]/97 border border-cyan-500/50 shadow-2xl text-xs text-slate-300">
        <p className="flex-1 leading-relaxed">
          gtcalc keeps your flows and settings in your browser so the app works. With your OK we also count anonymous visits (no cookies) to see how it's used.{' '}
          <a href="/privacy" className="text-cyan-300 hover:underline whitespace-nowrap">Privacy Policy</a>
          {' · '}
          <a href="/terms" className="text-cyan-300 hover:underline">Terms</a>
        </p>
        <div className="flex gap-2 flex-shrink-0 justify-end">
          <button onClick={() => setConsent('rejected')} className="flex-1 sm:flex-none px-4 py-1.5 border border-[#2b3548] bg-[#1b2230] hover:bg-[#232c3f] text-slate-200 font-bold">Reject</button>
          <button onClick={() => setConsent('accepted')} className="flex-1 sm:flex-none px-4 py-1.5 border border-emerald-500 bg-emerald-700 hover:bg-emerald-600 text-white font-bold">Accept</button>
        </div>
      </div>
    </div>
  );
}
