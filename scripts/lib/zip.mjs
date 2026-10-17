// Minimal read-only zip/jar reader (no dependencies).
// Supports stored and deflated entries, which covers every mod jar.
import fs from 'node:fs';
import zlib from 'node:zlib';

export class ZipFile {
  constructor(filePath) {
    this.path = filePath;
    this.buf = fs.readFileSync(filePath);
    this.entries = new Map();
    this.#readCentralDirectory();
  }

  #readCentralDirectory() {
    const buf = this.buf;
    // End of central directory record: scan backwards for its signature.
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`Not a zip file: ${this.path}`);

    const count = buf.readUInt16LE(eocd + 10);
    let ptr = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
      const method = buf.readUInt16LE(ptr + 10);
      const compSize = buf.readUInt32LE(ptr + 20);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const localOffset = buf.readUInt32LE(ptr + 42);
      const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
      this.entries.set(name, { method, compSize, localOffset });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
  }

  has(name) {
    return this.entries.has(name);
  }

  names() {
    return [...this.entries.keys()];
  }

  read(name) {
    const e = this.entries.get(name);
    if (!e) return null;
    const buf = this.buf;
    const nameLen = buf.readUInt16LE(e.localOffset + 26);
    const extraLen = buf.readUInt16LE(e.localOffset + 28);
    const start = e.localOffset + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`Unsupported compression method ${e.method} for ${name}`);
  }

  readText(name) {
    const b = this.read(name);
    return b ? b.toString('utf8') : null;
  }
}
