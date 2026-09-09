/* eslint-disable */
'use strict';

/**
 * Generates media/icon.png (128x128) for the extension — no image-library
 * dependency, just Node's zlib. The mark is a stylised hex grid with a
 * highlighted selection run, echoing the raw/structure viewer.
 *
 *   node scripts/gen-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SS = 4; // supersample factor
const W = SIZE * SS;

// RGBA canvas, transparent to start.
const px = new Float64Array(W * W * 4);

function blend(x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= W || y >= W || a <= 0) return;
  const i = (y * W + x) * 4;
  const ia = 1 - a;
  px[i] = r * a + px[i] * ia;
  px[i + 1] = g * a + px[i + 1] * ia;
  px[i + 2] = b * a + px[i + 2] * ia;
  px[i + 3] = 255 * a + px[i + 3] * ia;
}

/** Rounded rectangle in logical (128) coordinates. */
function roundRect(x, y, w, h, rad, color, alpha = 1) {
  const x0 = x * SS,
    y0 = y * SS,
    x1 = (x + w) * SS,
    y1 = (y + h) * SS,
    r = rad * SS;
  for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
    for (let pxi = Math.floor(x0); pxi < Math.ceil(x1); pxi++) {
      const cx = pxi + 0.5;
      const cy = py + 0.5;
      // nearest point on the inner (corner-centre) box
      const nx = Math.min(Math.max(cx, x0 + r), x1 - r);
      const ny = Math.min(Math.max(cy, y0 + r), y1 - r);
      const dx = cx - nx;
      const dy = cy - ny;
      if (dx * dx + dy * dy <= r * r + 1e-6) {
        blend(pxi, py, color, alpha);
      }
    }
  }
}

// ---- palette -------------------------------------------------------------
const BG = [23, 30, 43]; // #171E2B  dark slate
const BG_EDGE = [43, 56, 82]; // #2B3852  faint bevel
const DIM = [59, 79, 114]; // #3B4F72  idle byte cell
const BLUE = [79, 193, 255]; // #4FC1FF  selection / accent
const TAN = [226, 192, 141]; // #E2C08D  named field accent

// ---- compose ----------------------------------------------------------
// background plate + a 1px inner bevel
roundRect(4, 4, 120, 120, 24, BG_EDGE, 1);
roundRect(5, 5, 118, 118, 23, BG, 1);

const COLS = 6;
const ROWS = 4;
const CELL = 13;
const GAP = 5;
const gridW = COLS * CELL + (COLS - 1) * GAP;
const startX = Math.round((SIZE - gridW) / 2);
const startY = 30;

// which colour each cell gets
const layout = [
  [TAN, TAN, DIM, DIM, DIM, DIM],
  [DIM, DIM, BLUE, BLUE, BLUE, DIM],
  [DIM, DIM, DIM, DIM, DIM, DIM],
  [DIM, DIM, DIM, DIM, TAN, DIM],
];

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const cx = startX + col * (CELL + GAP);
    const cy = startY + row * (CELL + GAP);
    roundRect(cx, cy, CELL, CELL, 3, layout[row][col], 1);
  }
}

// selection underline beneath row 1 (cols 2..4)
const selX = startX + 2 * (CELL + GAP);
const selW = 3 * CELL + 2 * GAP;
const selY = startY + 1 * (CELL + GAP) + CELL + 3;
roundRect(selX, selY, selW, 3, 1.5, BLUE, 1);

// ---- downscale SS -> 1 ------------------------------------------------
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
        a += px[i + 3];
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
    out[o + 3] = Math.round(a / n);
  }
}

// ---- PNG encode -----------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 4)] = 0; // filter: none
  out.copy(raw, y * (1 + SIZE * 4) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = path.join(__dirname, '..', 'media', 'icon.png');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, png);
console.log(`Wrote ${target} (${png.length} bytes, ${SIZE}x${SIZE})`);
