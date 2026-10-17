export interface Rect { x: number; y: number; w: number; h: number }

export const overlaps = (a: Rect, b: Rect, margin = 0) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

/**
 * Closest position to `desired` where the rect overlaps none of `obstacles` (keeping `margin`
 * between them). Candidates are the desired spot plus every spot flush against an
 * obstacle edge, which is where the nearest free position always lies.
 */
export function nearestFree(
  desired: Rect,
  obstacles: Rect[],
  margin: number,
  accept: (x: number, y: number) => boolean = () => true,
): { x: number; y: number } {
  const free = (x: number, y: number) => {
    if (!accept(x, y)) return false;
    const r = { ...desired, x, y };
    for (const o of obstacles) if (overlaps(r, o, margin)) return false;
    return true;
  };
  if (free(desired.x, desired.y)) return { x: desired.x, y: desired.y };

  // Candidates come from nearby obstacles first (a close free spot is almost always flush
  // against a neighbour); widen only if nothing nearby works. Candidates are tried nearest
  // first, so the first free one is the answer.
  for (const radius of [500, 1500, Infinity]) {
    const xs = [desired.x];
    const ys = [desired.y];
    for (const o of obstacles) {
      if (radius !== Infinity && (o.x > desired.x + desired.w + radius || o.x + o.w < desired.x - radius || o.y > desired.y + desired.h + radius || o.y + o.h < desired.y - radius)) continue;
      xs.push(o.x - desired.w - margin, o.x + o.w + margin);
      ys.push(o.y - desired.h - margin, o.y + o.h + margin);
    }
    const cands: { x: number; y: number; d: number }[] = [];
    for (const x of xs) for (const y of ys) cands.push({ x, y, d: (x - desired.x) ** 2 + (y - desired.y) ** 2 });
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) if (free(c.x, c.y)) return { x: c.x, y: c.y };
  }
  return { x: desired.x, y: desired.y };
}

export interface BadgeRequest {
  id: string;
  anchorX: number; // wire start (source output port)
  anchorY: number;
  w: number;
  h: number;
}

/**
 * Place connection rate panels as close as possible to their source output port without
 * covering any machine or another panel.
 */
export function placeBadges(requests: BadgeRequest[], nodeRects: Rect[]): Map<string, Rect> {
  const placed = new Map<string, Rect>();
  const obstacles = [...nodeRects];
  const ordered = [...requests].sort((a, b) => a.anchorX - b.anchorX || a.anchorY - b.anchorY);
  for (const r of ordered) {
    const desired = { x: r.anchorX + 16, y: r.anchorY - r.h / 2, w: r.w, h: r.h };
    const pos = nearestFree(desired, obstacles, 8, (x) => x >= r.anchorX + 10);
    const rect = { ...desired, ...pos };
    placed.set(r.id, rect);
    obstacles.push(rect);
  }
  return placed;
}
