// Builds small .zip files for tests (deflate, UTF-8 names, unix modes), including broken ones:
// "../" names, symlinks, sizes that lie.

import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipItem {
  name: string;
  data?: Buffer | string;
  /** Unix mode (e.g. 0o120777 for a symlink). */
  mode?: number;
  /** Uncompressed size written into the headers (to make a lying zip). */
  declaredSize?: number;
}

export function makeZip(items: ZipItem[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const it of items) {
    const isDir = it.name.endsWith('/');
    const name = Buffer.from(it.name, 'utf8');
    const raw = isDir ? Buffer.alloc(0) : Buffer.isBuffer(it.data) ? it.data : Buffer.from(it.data ?? '');
    const method = isDir ? 0 : 8;
    const body = isDir ? raw : deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    const size = it.declaredSize ?? raw.length;
    const mode = it.mode ?? (isDir ? 0o040755 : 0o100644);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((mode << 16) | (isDir ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
