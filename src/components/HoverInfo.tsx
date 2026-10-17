import { useEffect, useRef, useState } from 'react';
import type { CanvasNode, Connection } from '../types';
import type { FlowResult } from '../solver';
import { formatRate } from '../format';
import { ItemIcon } from './ItemIcon';

interface Props {
  node: CanvasNode;
  nodeById: Map<string, CanvasNode>;
  connections: Connection[];
  flows: FlowResult;
}

const PANEL_W = 340; // full names wrap instead of being cut off
const GAP = 14;

const machineLabel = (n: CanvasNode) =>
  n.recipe.kind === 'supply' ? `Input (${n.recipe.recipeName})` : n.recipe.kind === 'output' ? `Output (${n.recipe.recipeName})` : `${n.gen && n.gen.kind !== 'single' ? n.gen.name : n.multi?.name ?? n.recipe.machineName} (${n.recipe.recipeName})`;

/**
 * Where a hovered node's inputs come from and where its outputs go, in one panel beside the
 * node that follows the mouse up and down. It tracks the mouse itself, so moving the mouse
 * re-renders only this panel, not the canvas.
 */
export function HoverInfo({ node, nodeById, connections, flows }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let mouseY = 0;
    const place = () => {
      frame = 0;
      const el = document.querySelector<HTMLElement>(`[data-node="${CSS.escape(node.instanceId)}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const h = panel.current?.offsetHeight ?? 200;
      // Beside the node, never on top: right if there's room, else left.
      const x = r.right + GAP + PANEL_W < window.innerWidth ? r.right + GAP : Math.max(4, r.left - GAP - PANEL_W);
      const y = Math.min(window.innerHeight - h - 48, Math.max(52, mouseY - 24));
      setPos({ x, y });
    };
    const move = (e: MouseEvent) => {
      mouseY = e.clientY;
      if (!frame) frame = requestAnimationFrame(place);
    };
    window.addEventListener('mousemove', move);
    // Show straight away (level with the node's middle) before the mouse moves.
    const el = document.querySelector<HTMLElement>(`[data-node="${CSS.escape(node.instanceId)}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      mouseY = r.top + Math.min(r.height / 2, 120);
      place();
    }
    return () => {
      window.removeEventListener('mousemove', move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [node.instanceId]);

  const f = flows.nodes.get(node.instanceId);
  const incoming = connections.filter((c) => c.targetInstanceId === node.instanceId);
  const outgoing = connections.filter((c) => c.sourceInstanceId === node.instanceId);
  const inputs = node.recipe.kind === 'supply' ? [] : Object.keys(f?.inputRates ?? {});
  const outputs = node.recipe.outputs;

  return (
    <div
      ref={panel}
      data-export-skip=""
      className="fixed z-40 pointer-events-none bg-[#151a24]/97 border border-cyan-500/50 shadow-2xl text-[11px] px-2.5 py-2 space-y-1.5"
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width: PANEL_W }}
    >
      <div className="font-bold text-slate-100 border-b border-slate-700/60 pb-1">{machineLabel(node)}</div>

      {inputs.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-rose-400 font-bold">Inputs</div>
          {inputs.map((id) => {
            const item = node.recipe.inputs.find((i) => i.id === id) ?? node.gen?.extras?.find((x) => x.id === id);
            if (!item) return null;
            const from = incoming.filter((c) => c.targetItemId === id);
            return (
              <div key={id}>
                <div className="flex items-center gap-1.5">
                  <ItemIcon id={item.id} color={item.iconColor} size={14} />
                  <span className="text-slate-200 flex-1 break-words min-w-0">{item.name}</span>
                  <span className="text-rose-400 font-bold">-{formatRate(f?.inputRates[id] ?? 0, item.unit)}</span>
                </div>
                {from.length ? from.map((c) => {
                  const s = nodeById.get(c.sourceInstanceId);
                  return s ? (
                    <div key={c.id} className="pl-5 text-slate-400 break-words min-w-0">
                      ← {machineLabel(s)} <span className="text-emerald-400/80">{formatRate(flows.connections.get(c.id)?.needed ?? 0, item.unit)}</span>
                    </div>
                  ) : null;
                }) : <div className="pl-5 text-slate-500 italic">raw input (not connected)</div>}
              </div>
            );
          })}
        </div>
      )}

      {inputs.length > 0 && outputs.length > 0 && <div className="border-t border-slate-700/60" />}

      {outputs.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">Outputs</div>
          {outputs.map((o) => {
            const to = outgoing.filter((c) => c.sourceItemId === o.id);
            const made = f?.outputRates[o.id] ?? 0;
            const sent = to.reduce((a, c) => a + (flows.connections.get(c.id)?.needed ?? 0), 0);
            const spare = made - sent;
            return (
              <div key={o.id}>
                <div className="flex items-center gap-1.5">
                  <ItemIcon id={o.id} color={o.iconColor} size={14} />
                  <span className="text-slate-200 flex-1 break-words min-w-0">{o.name}</span>
                  <span className="text-emerald-400 font-bold">+{formatRate(made, o.unit)}</span>
                </div>
                {to.map((c) => {
                  const t = nodeById.get(c.targetInstanceId);
                  return t ? (
                    <div key={c.id} className="pl-5 text-slate-400 break-words min-w-0">
                      → {machineLabel(t)} <span className="text-rose-400/80">{formatRate(flows.connections.get(c.id)?.needed ?? 0, o.unit)}</span>
                    </div>
                  ) : null;
                })}
                {spare > Math.max(1e-6, made * 1e-4) && <div className="pl-5 text-cyan-300/80">spare +{formatRate(spare, o.unit)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Last mouse position, so a panel can appear in the right place before the next move.
const lastMouse = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => { lastMouse.x = e.clientX; lastMouse.y = e.clientY; }, { passive: true });
}

interface WireProps {
  conn: Connection;
  nodeById: Map<string, CanvasNode>;
  connections: Connection[];
  flows: FlowResult;
}

/**
 * Hovering a wire: where it comes from, what it carries and how much, where it goes, and any
 * surplus. Only this wire's item, not the machines' other inputs. Follows the mouse.
 */
export function WireInfo({ conn, nodeById, connections, flows }: WireProps) {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({ x: lastMouse.x + 18, y: lastMouse.y + 14 }));
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const w = panel.current?.offsetWidth ?? PANEL_W;
      const h = panel.current?.offsetHeight ?? 120;
      const x = lastMouse.x + 18 + w < window.innerWidth ? lastMouse.x + 18 : lastMouse.x - 18 - w;
      const y = Math.min(window.innerHeight - h - 8, Math.max(52, lastMouse.y + 14));
      setPos({ x, y });
    };
    const move = () => { if (!frame) frame = requestAnimationFrame(place); };
    window.addEventListener('mousemove', move);
    place();
    return () => {
      window.removeEventListener('mousemove', move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [conn.id]);

  const src = nodeById.get(conn.sourceInstanceId);
  const dst = nodeById.get(conn.targetInstanceId);
  const item = src?.recipe.outputs.find((o) => o.id === conn.sourceItemId);
  if (!src || !dst || !item) return null;
  const cf = flows.connections.get(conn.id);
  const made = flows.nodes.get(src.instanceId)?.outputRates[item.id] ?? 0;
  const sentElsewhere = connections
    .filter((c) => c.sourceInstanceId === src.instanceId && c.sourceItemId === item.id && c.id !== conn.id)
    .reduce((a, c) => a + (flows.connections.get(c.id)?.needed ?? 0), 0);
  const taken = cf?.needed ?? 0;
  const spare = made - sentElsewhere - taken;
  const tol = Math.max(1e-6, made * 1e-4);

  return (
    <div
      ref={panel}
      data-export-skip=""
      className="fixed z-40 pointer-events-none bg-[#151a24]/97 border border-cyan-500/50 shadow-2xl text-[11px] px-2.5 py-2 space-y-1.5"
      style={{ left: pos.x, top: pos.y, width: PANEL_W }}
    >
      <div className="flex items-center gap-1.5 font-bold text-slate-100 border-b border-slate-700/60 pb-1">
        <ItemIcon id={item.id} color={item.iconColor} size={16} />
        <span className="break-words min-w-0">{item.name}</span>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">From</div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-200 break-words min-w-0">{machineLabel(src)}</span>
          <span className="text-emerald-400 font-bold whitespace-nowrap">makes +{formatRate(made, item.unit)}</span>
        </div>
        {sentElsewhere > tol && <div className="text-slate-500">{formatRate(sentElsewhere, item.unit)} of it goes to other machines</div>}
      </div>
      <div className="border-t border-slate-700/60" />
      <div>
        <div className="text-[10px] uppercase tracking-wider text-rose-400 font-bold">To</div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-200 break-words min-w-0">{machineLabel(dst)}</span>
          <span className="text-rose-400 font-bold whitespace-nowrap">takes {formatRate(taken, item.unit)}</span>
        </div>
      </div>
      {cf && cf.diff < -tol && <div className="text-rose-300 font-bold">Short {formatRate(-cf.diff, item.unit)}: the source can't make enough</div>}
      {spare > tol && <div className="text-cyan-300 font-bold">Surplus +{formatRate(spare, item.unit)} not used by anything</div>}
      {Math.abs(spare) <= tol && !(cf && cf.diff < -tol) && <div className="text-emerald-300 font-bold">Balanced: everything made is used</div>}
    </div>
  );
}
