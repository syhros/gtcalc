import type { ReactNode } from 'react';

/** Policies and the contact address, at the foot of the Guide, Community and My flows. */
export function SiteFooter({ className = '', children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 ${className}`}>
      <a href="/privacy" className="hover:text-cyan-300">Privacy</a>
      <a href="/terms" className="hover:text-cyan-300">Terms</a>
      <a href="mailto:support@gtcalc.app" className="hover:text-cyan-300" data-tip="Questions, bug reports, or a request to remove something">support@gtcalc.app</a>
      {children}
    </div>
  );
}
