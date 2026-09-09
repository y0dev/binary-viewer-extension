/* eslint-disable */
'use strict';

/**
 * Generates a test binary for nested / multi-dimensional arrays:
 *
 *   examples/binaries/grid3d.bin   (matches examples/formats/grid3d.json)
 *
 * Layout (little-endian):
 *   0x00  magic    "G3D1"                                4 bytes
 *   0x04  small     int16[2][3][4]  cell = P*100+R*10+C  48 bytes
 *   0x34  planes    uint16 = 2      (countField source)  2
 *   0x36  rows      uint16 = 4                           2
 *   0x38  cols      uint16 = 40000                       2
 *   0x3A  pad       uint16 = 0                           2
 *   0x3C  big       int16[planes][rows][cols]            planes*rows*cols*2
 *                   cell = running index, wrapping at 0x8000 (stays positive)
 *
 *   node scripts/gen-grid3d.js
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'examples', 'binaries');
fs.mkdirSync(OUT, { recursive: true });

const P = 2;
const R = 4;
const C = 40000; // big enough to exceed the default maxArrayElements (1000)

const SMALL = 2 * 3 * 4 * 2; // 48
const HEADER = 4 + SMALL + 8; // magic + small + planes/rows/cols/pad  -> 0x3C
const bigBytes = P * R * C * 2;
const buf = Buffer.alloc(HEADER + bigBytes);

// magic
buf.write('G3D1', 0, 'ascii');

// small int16[2][3][4], cell = plane*100 + row*10 + col
let o = 4;
for (let p = 0; p < 2; p++)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      buf.writeInt16LE(p * 100 + r * 10 + c, o);
      o += 2;
    }

// dimensions for the length-prefixed big array
buf.writeUInt16LE(P, 0x34);
buf.writeUInt16LE(R, 0x36);
buf.writeUInt16LE(C, 0x38);
buf.writeUInt16LE(0, 0x3a);

// big int16[P][R][C], cell = running index (wraps at 0x8000, stays positive)
for (let i = 0; i < P * R * C; i++) {
  buf.writeInt16LE(i & 0x7fff, HEADER + i * 2);
}

const file = path.join(OUT, 'grid3d.bin');
fs.writeFileSync(file, buf);
console.log(`wrote ${file}  (${buf.length.toLocaleString()} bytes)`);
