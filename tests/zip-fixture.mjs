import {inflateRawSync} from 'node:zlib';

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit=0;bit<8;bit++) value = (value>>>1) ^ ((value&1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Small generated fixtures only: no ZIP64, encryption, or filesystem extraction.
export function unzip(bytes) {
  const entries = new Map();
  const end = bytes.length-22;
  if (bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Fixture ZIP must have no archive comment.');
  let position = bytes.readUInt32LE(end+16);
  for (let index=0;index<bytes.readUInt16LE(end+10);index++) {
    if (bytes.readUInt32LE(position) !== 0x02014b50) throw new Error('Invalid fixture ZIP directory.');
    const nameLength=bytes.readUInt16LE(position+28),extra=bytes.readUInt16LE(position+30),comment=bytes.readUInt16LE(position+32);
    const name=bytes.subarray(position+46,position+46+nameLength).toString('utf8');
    const offset=bytes.readUInt32LE(position+42),size=bytes.readUInt32LE(position+20),method=bytes.readUInt16LE(position+10);
    const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);
    const compressed=bytes.subarray(start,start+size);
    if (![0,8].includes(method)) throw new Error('Unsupported fixture ZIP method.');
    const data=method===0?compressed:inflateRawSync(compressed);
    if (crc32(data)!==bytes.readUInt32LE(position+16)) throw new Error('Fixture ZIP CRC mismatch.');
    entries.set(name,data);position+=46+nameLength+extra+comment;
  }
  return entries;
}

export function zip(entries) {
  const local=[],central=[];let offset=0;
  for (const [name,data] of entries) {
    const encoded=Buffer.from(name),crc=crc32(data),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(encoded.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);
    directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(encoded.length,28);directory.writeUInt32LE(offset,42);
    local.push(header,encoded,data);central.push(directory,encoded);offset+=30+encoded.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
