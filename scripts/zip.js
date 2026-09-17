/* A minimal ZIP writer.
 *
 * The dashboard exports a design as several PNGs at once. A browser will only
 * reliably start one download per gesture, so they have to arrive as one file,
 * and the page's Content-Security-Policy allows no third-party script — so no
 * zip library can be pulled from a CDN.
 *
 * Everything here is STORED, not deflated. PNGs are already compressed, so
 * deflating them again would add a compressor's worth of code to save almost
 * nothing. The result is a perfectly ordinary .zip that any tool will open.
 *
 * Format reference: PKWARE APPNOTE, sections 4.3.7 (local header), 4.3.12
 * (central directory) and 4.3.16 (end of central directory).
 */

// Standard CRC-32, table built once on first use.
let crcTable = null;

function makeCrcTable() {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }

  return table;
}

function crc32(bytes) {
  if (!crcTable) crcTable = makeCrcTable();

  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
}

/* ZIP stores timestamps in MS-DOS format: a 16-bit date and a 16-bit time,
 * with two-second resolution and years counted from 1980. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());

  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  };
}

function bytesOf(text) {
  return new TextEncoder().encode(text);
}

/* Builds a zip from [{ name, bytes }] and returns it as a Blob.
 *
 * `bytes` may be a Uint8Array or a string; strings are written as UTF-8, which
 * is what the manifest needs.
 */
export function makeZip(entries) {
  const stamp = dosDateTime(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  entries.forEach(entry => {
    const name = bytesOf(entry.name);
    const data = typeof entry.bytes === 'string' ? bytesOf(entry.bytes) : entry.bytes;
    const sum = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header signature
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // UTF-8 names
    local.setUint16(8, 0, true);            // stored, no compression
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);           // no extra field

    parts.push(new Uint8Array(local.buffer), name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);     // central directory signature
    dir.setUint16(4, 20, true);             // version made by
    dir.setUint16(6, 20, true);             // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, stamp.time, true);
    dir.setUint16(14, stamp.date, true);
    dir.setUint32(16, sum, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint16(30, 0, true);             // extra
    dir.setUint16(32, 0, true);             // comment
    dir.setUint16(34, 0, true);             // disk number
    dir.setUint16(36, 0, true);             // internal attributes
    dir.setUint32(38, 0, true);             // external attributes
    dir.setUint32(42, offset, true);        // where the local header sits

    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + data.length;
  });

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);               // no comment

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
                  { type: 'application/zip' });
}
