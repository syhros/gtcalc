/**
 * Per-IP rate limit kept in this server instance's memory. Vercel runs several instances and
 * recycles them, so this slows one client down rather than enforcing a hard cap. Entries older
 * than the window are pruned, so the map can't grow without bound.
 */
export function ipThrottle(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (request: Request): boolean => {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    if (hits.size > 5000) for (const [k, times] of hits) if (now - times[times.length - 1] >= windowMs) hits.delete(k);
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) { hits.set(ip, recent); return false; }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };
}
