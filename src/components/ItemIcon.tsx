import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { atlasCell, getIconVersion, itemIcon, subscribeIcons, textureUrl, type ItemIconSpec } from '../recipeData';
import { visibleColor } from '../format';

interface Props {
  id: string;
  color?: string; // fallback swatch colour
  size?: number;
  glow?: boolean;
  className?: string;
  title?: string;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(ref: string) {
  const url = textureUrl(ref); // sprite sheet cells share their sheet's image
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

const hexRgb = (hex: string) => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Draw the icon the way the game does: greyscale templates multiplied by the material
 * colour, layered base -> secondary -> overlay. Animated textures are vertical strips, so
 * only the first (top) frame is used. The result is cached as a PNG data URL, which also
 * keeps icons intact in exported images.
 */
const composed = new Map<string, Promise<string | null>>();
function composeIcon(spec: ItemIconSpec): Promise<string | null> {
  const key = spec.join('|');
  let p = composed.get(key);
  if (!p) {
    p = (async () => {
      const [base, tint, overlay, secondary, secondaryTint] = spec;
      const layers: [string, string | null | undefined][] = [[base, tint]];
      if (secondary) layers.push([secondary, secondaryTint ?? tint]);
      if (overlay) layers.push([overlay, null]);
      const imgs = await Promise.all(layers.map(([ref]) => loadImage(ref)));
      if (!imgs[0]) return null;
      const cellOf = layers.map(([ref]) => atlasCell(ref));
      const size = cellOf[0]?.size ?? (imgs[0].naturalWidth || 16);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const scratch = document.createElement('canvas');
      scratch.width = size;
      scratch.height = size;
      const sctx = scratch.getContext('2d', { willReadFrequently: true })!;
      layers.forEach(([, t], i) => {
        const img = imgs[i];
        if (!img) return;
        sctx.clearRect(0, 0, size, size);
        const cell = cellOf[i];
        if (cell) sctx.drawImage(img, cell.x, cell.y, cell.size, cell.size, 0, 0, size, size);
        else sctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalWidth, 0, 0, size, size);
        if (t) {
          const [r, g, b] = hexRgb(t);
          const data = sctx.getImageData(0, 0, size, size);
          const px = data.data;
          for (let k = 0; k < px.length; k += 4) {
            px[k] = (px[k] * r) / 255;
            px[k + 1] = (px[k + 1] * g) / 255;
            px[k + 2] = (px[k + 2] * b) / 255;
          }
          sctx.putImageData(data, 0, 0);
        }
        ctx.drawImage(scratch, 0, 0);
      });
      return canvas.toDataURL();
    })().catch(() => null);
    composed.set(key, p);
  }
  return p;
}
const ready = new Map<string, string | null>(); // finished compositions, for a synchronous first render

/** The item's in-game texture, or a colour swatch when it has none. */
export const ItemIcon = React.memo(function ItemIcon({ id, color, size = 16, glow, className = '', title }: Props) {
  useSyncExternalStore(subscribeIcons, getIconVersion);
  const spec = itemIcon(id);
  const key = spec?.join('|');
  const [src, setSrc] = useState<string | null | undefined>(() => (key ? ready.get(key) : null));
  useEffect(() => {
    if (!spec || !key) { setSrc(null); return; }
    if (ready.has(key)) { setSrc(ready.get(key)); return; }
    let live = true;
    void composeIcon(spec).then((url) => {
      ready.set(key, url);
      if (live) setSrc(url);
    });
    return () => { live = false; };
    // spec is derived from id; key captures its content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const swatch = visibleColor(color);
  if (!src) {
    return (
      <span className={`inline-flex items-center justify-center flex-shrink-0 ${className}`} style={{ width: size, height: size }} data-tip={title}>
        <span
          className="block border border-black/50"
          style={{ width: Math.round(size * 0.7), height: Math.round(size * 0.7), backgroundColor: swatch, boxShadow: glow ? `0 0 7px ${swatch}` : undefined, opacity: spec ? 0.5 : 1 }}
        />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={`pixelated flex-shrink-0 ${className}`}
      style={{ width: size, height: size, filter: glow ? `drop-shadow(0 0 3px ${swatch})` : undefined }}
      data-tip={title}
    />
  );
});
