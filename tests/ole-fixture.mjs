// Minimal OLE compound-file reader and HWP record splitter for byte-level checks of exported HWP files.
import {inflateRawSync} from 'node:zlib';

const END = 0xFFFFFFFA;
export function oleStreams(buffer) {
  const data = Buffer.from(buffer);
  const ss = 1 << data.readUInt16LE(0x1e), ms = 1 << data.readUInt16LE(0x20);
  const fatCount = data.readUInt32LE(0x2c), dirStart = data.readUInt32LE(0x30), cutoff = data.readUInt32LE(0x38), miniFatStart = data.readUInt32LE(0x3c);
  const sector = i => data.subarray((i + 1) * ss, (i + 2) * ss);
  const words = chunk => {const out = []; for (let k = 0; k + 4 <= chunk.length; k += 4) out.push(chunk.readUInt32LE(k)); return out;};
  const difat = []; for (let i = 0; i < 109; i++) difat.push(data.readUInt32LE(0x4c + i * 4));
  for (let next = data.readUInt32LE(0x44); next < END;) {const chunk = sector(next); difat.push(...words(chunk.subarray(0, ss - 4))); next = chunk.readUInt32LE(ss - 4);}
  const fat = difat.slice(0, fatCount).flatMap(i => words(sector(i)));
  const chain = (start, table) => {const out = []; for (let s = start; s < END && out.length < 1e6; s = table[s]) out.push(s); return out;};
  const read = (start, size) => Buffer.concat(chain(start, fat).map(sector)).subarray(0, size);
  const dir = Buffer.concat(chain(dirStart, fat).map(sector)), entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const e = dir.subarray(off, off + 128), nameLength = e.readUInt16LE(64);
    entries.push({name: e.subarray(0, Math.max(nameLength - 2, 0)).toString('utf16le'), type: e[66], left: e.readUInt32LE(68), right: e.readUInt32LE(72), child: e.readUInt32LE(76), start: e.readUInt32LE(116), size: e.readUInt32LE(120)});
  }
  const root = entries[0], mini = root.start < END ? read(root.start, root.size) : Buffer.alloc(0);
  const miniFat = miniFatStart < END ? chain(miniFatStart, fat).flatMap(i => words(sector(i))) : [];
  const readMini = (start, size) => Buffer.concat(chain(start, miniFat).map(k => mini.subarray(k * ms, (k + 1) * ms))).subarray(0, size);
  const streams = new Map();
  (function walk(index, prefix) {
    if (index >= entries.length) return;
    const e = entries[index]; walk(e.left, prefix); walk(e.right, prefix);
    if (e.type === 2) streams.set(prefix + e.name, e.size < cutoff ? readMini(e.start, e.size) : read(e.start, e.size));
    else if (e.type === 1 || e.type === 5) walk(e.child, e.type === 1 ? prefix + e.name + '/' : prefix);
  })(root.child, '');
  return streams;
}

export function hwpRecords(buffer, streamName = 'BodyText/Section0') {
  const streams = oleStreams(buffer), header = streams.get('FileHeader'), raw = streams.get(streamName);
  if (!header || !raw) throw new Error('missing stream ' + streamName);
  const body = header[36] & 1 ? inflateRawSync(raw) : raw, records = [];
  for (let pos = 0; pos + 4 <= body.length;) {
    const word = body.readUInt32LE(pos); pos += 4;
    let size = word >>> 20; if (size === 0xfff) {size = body.readUInt32LE(pos); pos += 4;}
    records.push({tag: word & 0x3ff, level: (word >>> 10) & 0x3ff, body: body.subarray(pos, pos + size)}); pos += size;
  }
  return records;
}

// SHAPE_COMPONENT (tag 76) stores a flip/storage word after the size fields; top-level shapes repeat the control id once.
export function shapeStorageWords(buffer) {
  return hwpRecords(buffer).filter(r => r.tag === 76).map(r => {const two = r.body.subarray(0, 4).equals(r.body.subarray(4, 8)); return r.body.readUInt32LE(two ? 36 : 32);});
}
