import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { suggestPack, type PackSuggestion } from '../community';

interface Hit { name: string; summary: string; url: string; icon: string | null; downloads: number; source: PackSuggestion['source'] }

/**
 * "Suggest a pack": search Modrinth's modpacks as you type, or paste a link (CurseForge or
 * anything else). Each pack collects votes; moderators see the counts.
 */
export function SuggestPackModal({ loggedIn, onLogin, onClose, onDone }: { loggedIn: boolean; onLogin: () => void; onClose: () => void; onDone: (msg: string) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [chosen, setPicked] = useState<{ name: string; url: string; source: PackSuggestion['source'] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isLink = /^https?:\/\//i.test(query.trim());
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || isLink) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      // Modpack Index (CurseForge and Modrinth, via /api/pack-search); Modrinth directly if that's down.
      const modrinth = () => {
        const facets = encodeURIComponent(JSON.stringify([['project_type:modpack']]));
        return fetch(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(q)}&facets=${facets}&limit=6`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : { hits: [] }))
          .then((j: { hits: { slug: string; title: string; description: string; icon_url?: string; downloads: number }[] }) => (j.hits ?? []).map((h): Hit => ({
            name: h.title, summary: h.description, url: `https://modrinth.com/modpack/${h.slug}`, icon: h.icon_url ?? null, downloads: h.downloads, source: 'modrinth',
          })));
      };
      fetch(`/api/pack-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : Promise.reject(new Error('no search'))))
        .then((j: { hits: Hit[] }) => (j.hits?.length ? j.hits : modrinth()))
        .catch(() => modrinth())
        .then((list) => setHits(list ?? []))
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, isLink]);

  // A pasted link is the suggestion itself.
  const fromLink = useMemo((): typeof chosen => {
    if (!isLink) return null;
    const url = query.trim().replace(/^http:/i, 'https:');
    const slug = url.match(/\/modpacks?\/([\w-]+)/i)?.[1];
    const name = slug ? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : url.replace(/^https:\/\/(www\.)?/, '').split('/')[0];
    return { name, url, source: /curseforge\.com/i.test(url) ? 'curseforge' : /modrinth\.com/i.test(url) ? 'modrinth' : 'link' };
  }, [query, isLink]);
  const picked = fromLink ?? chosen;
  const shown = query.trim().length >= 2 && !isLink ? hits : [];

  const submit = async () => {
    if (!picked) return;
    setBusy(true); setError('');
    try {
      const added = await suggestPack(picked.name, picked.url, picked.source);
      onDone(added ? `Thanks! Your vote for ${picked.name} is in` : `You've already suggested ${picked.name}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[65] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-[440px] max-w-full bg-[#161a24] border border-cyan-500/50 shadow-2xl text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#283244]">
          <div className="font-pixel-bold text-cyan-300 uppercase text-sm">Suggest a pack</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-slate-400">Which GregTech modpack should gtcalc support next? Start typing its name, or paste a link to it (Modrinth, CurseForge or its website).</div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
              placeholder="Pack name, or a link (https://...)"
              className="w-full bg-[#12151e] border border-[#2b3548] pl-8 pr-2.5 py-2 text-slate-200 focus:border-cyan-400 outline-none"
            />
          </div>
          {shown.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {shown.map((h) => {
                const on = picked?.url === h.url;
                return (
                  <button
                    key={h.url}
                    onClick={() => setPicked({ name: h.name, url: h.url, source: h.source })}
                    className={`w-full flex items-center gap-2 p-1.5 border text-left ${on ? 'border-cyan-400 bg-cyan-950/60' : 'border-[#2b3548] hover:bg-[#202737]'}`}
                  >
                    {h.icon && /^https:\/\//i.test(h.icon) ? <img src={h.icon} alt="" referrerPolicy="no-referrer" className="w-8 h-8 flex-shrink-0 bg-[#12151e]" /> : <span className="w-8 h-8 flex-shrink-0 bg-[#12151e]" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-slate-100 truncate">{h.name}</span>
                      <span className="block text-[10px] text-slate-500 truncate">{h.summary}</span>
                    </span>
                    <span className="text-right whitespace-nowrap">
                      <span className="block text-[10px] text-slate-500">{h.downloads >= 1000 ? `${Math.round(h.downloads / 1000)}k` : h.downloads} dl</span>
                      <span className={`block text-[9px] uppercase font-bold ${h.source === 'curseforge' ? 'text-orange-400' : 'text-emerald-400'}`}>{h.source}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {!isLink && query.trim().length >= 2 && !shown.length && <div className="text-slate-500 italic">No packs match. Paste a link to it instead.</div>}
          {picked && <div className="text-slate-300">Suggesting <span className="text-cyan-300 font-bold">{picked.name}</span> <span className="text-slate-500 break-all">({picked.url})</span></div>}
          {error && <div className="text-rose-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 border border-[#2b3548] text-slate-300 font-bold hover:bg-[#202737]">Cancel</button>
            {loggedIn
              ? <button disabled={!picked || busy} onClick={() => void submit()} className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 font-bold disabled:opacity-40">{busy ? 'Sending…' : 'Suggest'}</button>
              : <button onClick={onLogin} className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 font-bold">Log in to suggest</button>}
          </div>
          <div className="text-[10px] text-slate-500">Search results from Modpack Index (CurseForge and Modrinth).</div>
        </div>
      </div>
    </div>
  );
}
