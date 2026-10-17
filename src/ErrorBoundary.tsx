import React from 'react';

/**
 * Last line of defence: if rendering throws (a corrupt saved flow, a bad import), show a way
 * out instead of a blank page. Saved flows are untouched; "Start with an empty canvas" only
 * clears the open canvas so the app can load again.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('gtcalc crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const clearCanvas = () => {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('gt_calc_saved')) localStorage.removeItem(k);
      } catch { /* storage unavailable */ }
      location.reload();
    };
    return (
      <div style={{ minHeight: '100vh', background: '#11141c', color: '#e2e8f0', fontFamily: "'Courier New', monospace", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ maxWidth: 460, border: '2px solid #22d3ee', background: '#161a24', padding: 20 }}>
          <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 8 }}>Something went wrong</div>
          <p style={{ fontSize: 13, lineHeight: '20px', color: '#94a3b8', margin: '0 0 14px' }}>
            The page hit an error and couldn't draw. Your saved flows are safe. Try reloading; if it happens again, start with an empty canvas (only the open canvas is cleared).
          </p>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14, wordBreak: 'break-word' }}>{String(this.state.error.message).slice(0, 200)}</div>
          <button onClick={() => location.reload()} style={{ marginRight: 8, padding: '6px 12px', border: '1px solid #22d3ee', background: '#0e3a4a', color: '#e0fbff', fontWeight: 'bold', cursor: 'pointer' }}>Reload</button>
          <button onClick={clearCanvas} style={{ padding: '6px 12px', border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}>Start with an empty canvas</button>
        </div>
      </div>
    );
  }
}
