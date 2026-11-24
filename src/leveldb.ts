// A read-only LevelDB reader for Hydra's `hydra-db`. It reads every table and log in the folder
// and keeps the newest sequence per key; it never takes LOCK, so it works while Hydra runs.
// Formats: leveldb doc/table_format.md, doc/log_format.md, and Snappy's format_description.txt.
import * as fs from "node:fs";
import * as path from "node:path";

const TABLE_MAGIC = Buffer.from("57fb808b247547db", "hex");
const FOOTER = 48;
const LOG_BLOCK = 32 * 1024;
const LOG_HEADER = 7;

class Cursor {
  constructor(
    readonly buf: Buffer,
    public pos = 0,
  ) {}

  varint(): number {
    let out = 0;
    for (let shift = 0; shift < 64; shift += 7) {
      const b = this.buf[this.pos++];
      if (b === undefined) throw new Error("varint past the end");
      out += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return out;
    }
    throw new Error("varint too long");
  }

  take(n: number): Buffer {
    if (this.pos + n > this.buf.length) throw new Error("read past the end");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/** Raw (unframed) Snappy, which LevelDB uses for table blocks. */
export const unsnappy = (src: Buffer): Buffer => {
  const c = new Cursor(src);
  const out = Buffer.alloc(c.varint());
  let o = 0;
  while (c.pos < src.length) {
    const tag = src[c.pos++] as number;
    let len: number;
    let offset = 0;
    switch (tag & 3) {
      case 0: {
        len = tag >> 2;
        if (len >= 60) len = c.take(len - 59).readUIntLE(0, len - 59);
        len += 1;
        if (o + len > out.length) throw new Error("snappy literal overflows");
        c.take(len).copy(out, o);
        o += len;
        continue;
      }
      case 1:
        len = ((tag >> 2) & 7) + 4;
        offset = ((tag >> 5) << 8) | (c.take(1)[0] as number);
        break;
      case 2:
        len = (tag >> 2) + 1;
        offset = c.take(2).readUInt16LE(0);
        break;
      default:
        len = (tag >> 2) + 1;
        offset = c.take(4).readUInt32LE(0);
    }
    if (offset === 0 || offset > o || o + len > out.length) {
      throw new Error("snappy copy out of range");
    }
    // Byte by byte: a copy may overlap the bytes it is producing.
    for (let i = 0; i < len; i++) out[o + i] = out[o - offset + i] as number;
    o += len;
  }
  if (o !== out.length) throw new Error("snappy length mismatch");
  return out;
};

/** A table block's entries: keys are prefix-compressed against the one before. */
const blockEntries = (block: Buffer): Array<[Buffer, Buffer]> => {
  const restarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - 4 * restarts;
  const c = new Cursor(block);
  const out: Array<[Buffer, Buffer]> = [];
  let key = Buffer.alloc(0);
  while (c.pos < end) {
    const shared = c.varint();
    const unshared = c.varint();
    const valueLen = c.varint();
    key = Buffer.concat([key.subarray(0, shared), c.take(unshared)]);
    out.push([key, c.take(valueLen)]);
  }
  return out;
};

const pread = (fd: number, offset: number, length: number): Buffer => {
  const buf = Buffer.alloc(length);
  const got = fs.readSync(fd, buf, 0, length, offset);
  if (got !== length) throw new Error("short read");
  return buf;
};

/** A block and its 5-byte trailer: compression type, then a CRC this reader doesn't check. */
const readBlock = (fd: number, handle: Buffer): Buffer => {
  const h = new Cursor(handle);
  const offset = h.varint();
  const size = h.varint();
  const raw = pread(fd, offset, size + 1);
  const body = raw.subarray(0, size);
  if (raw[size] === 0) return body;
  if (raw[size] === 1) return unsnappy(body);
  throw new Error(`unknown block compression ${raw[size]}`);
};

type Put = (key: Buffer, seq: number, value: Buffer | null) => void;

/** `[lo, hi)` covering every key that starts with `prefix`. */
const rangeOf = (prefix: string): [Buffer, Buffer] => {
  const lo = Buffer.from(prefix);
  const hi = Buffer.from(lo);
  hi[hi.length - 1] = (hi[hi.length - 1] as number) + 1;
  return [lo, hi];
};

/** Internal key = user key + 8 bytes: type in the low byte, sequence in the other seven. */
const splitInternal = (ikey: Buffer, value: Buffer, put: Put) => {
  const n = ikey.length - 8;
  let seq = 0;
  for (let i = 7; i >= 1; i--) seq = seq * 256 + (ikey[n + i] as number);
  put(ikey.subarray(0, n), seq, ikey[n] === 1 ? value : null);
};

/**
 * One table. The index names each data block's last key, so a block that can't hold a wanted
 * key is never read or decompressed.
 */
const readTable = (file: string, ranges: Array<[Buffer, Buffer]>, put: Put) => {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size < FOOTER) throw new Error("table shorter than its footer");
    const footer = pread(fd, size - FOOTER, FOOTER);
    if (!footer.subarray(FOOTER - 8).equals(TABLE_MAGIC)) {
      throw new Error("not a table");
    }
    const f = new Cursor(footer);
    f.varint();
    f.varint();
    const indexStart = f.pos;
    f.varint();
    f.varint();
    const index = blockEntries(readBlock(fd, footer.subarray(indexStart, f.pos)));
    let prev: Buffer | undefined;
    for (const [separator, handle] of index) {
      const last = separator.subarray(0, separator.length - 8);
      const wanted = ranges.some(
        ([lo, hi]) =>
          Buffer.compare(lo, last) <= 0 && (prev === undefined || Buffer.compare(prev, hi) < 0),
      );
      prev = last;
      if (!wanted) continue;
      for (const [ikey, value] of blockEntries(readBlock(fd, handle))) {
        splitInternal(ikey, value, put);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
};

/** A write batch: sequence, count, then tagged records. */
const readBatch = (batch: Buffer, put: Put) => {
  let seq = Number(batch.readBigUInt64LE(0));
  const count = batch.readUInt32LE(8);
  const c = new Cursor(batch, 12);
  for (let i = 0; i < count; i++, seq++) {
    const type = c.take(1)[0];
    const key = c.take(c.varint());
    put(key, seq, type === 1 ? c.take(c.varint()) : null);
  }
};

/** One log. A torn record at the tail is a write in flight: everything before it counts. */
const readLog = (file: string, put: Put) => {
  const buf = fs.readFileSync(file);
  let pos = 0;
  let parts: Buffer[] | undefined;
  while (pos + LOG_HEADER <= buf.length) {
    const left = LOG_BLOCK - (pos % LOG_BLOCK);
    if (left < LOG_HEADER) {
      pos += left;
      continue;
    }
    const len = buf.readUInt16LE(pos + 4);
    const type = buf[pos + 6];
    const end = pos + LOG_HEADER + len;
    if (type === 0 || end > buf.length) break;
    const fragment = buf.subarray(pos + LOG_HEADER, end);
    pos = end;
    if (type === 1) readBatch(fragment, put);
    else if (type === 2) parts = [fragment];
    else if (parts && type === 3) parts.push(fragment);
    else if (parts && type === 4) {
      readBatch(Buffer.concat([...parts, fragment]), put);
      parts = undefined;
    }
  }
};

const vanished = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

/** A live value and the sequence number of the write that set it. */
export interface Row {
  readonly seq: number;
  readonly value: string;
}

/**
 * Every live value under one of `prefixes`, by key. Unreadable files are skipped. A file
 * compacted away mid-read restarts the read, so a game never drops out for one scan.
 */
export const readLevelDb = (dir: string, prefixes: ReadonlyArray<string>): Map<string, Row> => {
  const ranges = prefixes.map(rangeOf);
  for (let attempt = 0; ; attempt++) {
    const newest = new Map<string, { seq: number; value: Buffer | null }>();
    const put: Put = (key, seq, value) => {
      if (!ranges.some(([lo, hi]) => key.compare(lo) >= 0 && key.compare(hi) < 0)) return;
      const k = key.toString("utf8");
      const had = newest.get(k);
      if (!had || seq > had.seq) newest.set(k, { seq, value });
    };
    let restart = false;
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      try {
        if (name.endsWith(".ldb") || name.endsWith(".sst")) {
          readTable(file, ranges, put);
        } else if (name.endsWith(".log")) {
          readLog(file, put);
        }
      } catch (e) {
        if (vanished(e) && attempt < 3) restart = true;
      }
    }
    if (restart) continue;
    const out = new Map<string, Row>();
    for (const [k, { seq, value }] of newest) {
      if (value) out.set(k, { seq, value: value.toString("utf8") });
    }
    return out;
  }
};
