// Tiny PNG decoder used only to compute the average colour of a texture
// (custom-textured GTCEu fluids have no colour value in their material definition).
import zlib from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Returns '#rrggbb' averaged over visible pixels, or null if the PNG is unsupported. */
export function averagePngColor(buf) {
  if (!buf || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || !(colorType in CHANNELS)) return null;

  const ch = CHANNELS[colorType];
  const stride = width * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      px[y * stride + x] = v & 0xff;
    }
  }

  let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * ch;
    let R, G, B, A = 255;
    if (colorType === 0) { R = G = B = px[o]; }
    else if (colorType === 4) { R = G = B = px[o]; A = px[o + 1]; }
    else if (colorType === 2) { R = px[o]; G = px[o + 1]; B = px[o + 2]; }
    else if (colorType === 6) { R = px[o]; G = px[o + 1]; B = px[o + 2]; A = px[o + 3]; }
    else {
      const idx = px[o];
      if (!palette) return null;
      R = palette[idx * 3]; G = palette[idx * 3 + 1]; B = palette[idx * 3 + 2];
      if (trns && idx < trns.length) A = trns[idx];
    }
    if (A < 32) continue;
    r += R; g += G; bl += B; n++;
  }
  if (!n) return null;
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}
