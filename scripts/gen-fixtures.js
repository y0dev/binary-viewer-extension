/* eslint-disable */
'use strict';

/**
 * Generates binary test fixtures.
 *
 *   node scripts/gen-fixtures.js            # small + medium real files
 *   node scripts/gen-fixtures.js --huge     # also 100 MB and a 1 GB sparse file
 *
 * Output goes to test/fixtures/generated/ (git-ignored).
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'generated');
fs.mkdirSync(OUT, { recursive: true });

function patternBuffer(size) {
  const buf = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) {
    // deterministic, non-trivial pattern
    buf[i] = (i * 131 + (i >> 8) * 7) & 0xff;
  }
  return buf;
}

function writeReal(name, size) {
  const p = path.join(OUT, name);
  const CHUNK = 1 << 20;
  const fd = fs.openSync(p, 'w');
  let written = 0;
  while (written < size) {
    const n = Math.min(CHUNK, size - written);
    const buf = patternBuffer(n);
    // shift the pattern by the absolute offset so it stays position-dependent
    for (let i = 0; i < n; i++) {
      buf[i] = (buf[i] + ((written + i) & 0xff)) & 0xff;
    }
    fs.writeSync(fd, buf, 0, n);
    written += n;
  }
  fs.closeSync(fd);
  console.log(`  ${name}: ${size} bytes`);
}

function writeSparse(name, size) {
  const p = path.join(OUT, name);
  const fd = fs.openSync(p, 'w');
  try {
    fs.ftruncateSync(fd, size);
    // Drop a recognizable marker near the end so range reads can be verified.
    const marker = Buffer.from('BINVIEW-EOF-MARKER');
    fs.writeSync(fd, marker, 0, marker.length, size - marker.length);
    console.log(`  ${name}: ${size} bytes (sparse)`);
  } finally {
    fs.closeSync(fd);
  }
}

// A file that matches the "Firmware Image (example)" builtin format.
function writeFirmware() {
  const p = path.join(OUT, 'firmware.bin');
  const buf = Buffer.alloc(4096);
  buf.write('FW', 0, 'ascii'); // magic
  buf[2] = 0x01; // magic byte 3
  buf[3] = 0x00; // magic byte 4
  buf.writeUInt16LE(2, 4); // Version
  buf.writeUInt16LE(0b0000_0101, 6); // Flags: Compressed + Encrypted
  buf.writeUInt32LE(8192, 8); // Image Size
  buf.writeUInt32LE(0x00200000, 12); // Load Address
  buf.writeUInt32LE(Math.floor(Date.UTC(2024, 0, 2) / 1000), 16); // Build Timestamp
  buf.writeUInt32LE(0x78563412, 20); // CRC32
  buf.write('ACME-ROUTER-9000', 24, 'ascii'); // Product
  fs.writeFileSync(p, buf);
  console.log('  firmware.bin: 4096 bytes');
}

console.log('Generating fixtures in', OUT);
writeReal('1mb.bin', 1 << 20);
writeReal('10mb.bin', 10 << 20);
writeFirmware();

if (process.argv.includes('--huge')) {
  writeReal('100mb.bin', 100 << 20);
  writeSparse('1gb.bin', 1024 * 1024 * 1024);
}

console.log('Done.');
