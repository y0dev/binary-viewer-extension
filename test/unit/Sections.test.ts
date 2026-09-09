import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  normalizeAddress,
  buildSections,
  hasFlagsColumn,
  hasDisplayColumn,
} from '../../src/core/Sections';
import { validateFormat } from '../../src/core/FormatSchema';
import type { FormatDefinition } from '../../src/types/format';

const REPO = path.resolve(__dirname, '../../..');
const readFormat = (name: string): FormatDefinition =>
  JSON.parse(fs.readFileSync(path.join(REPO, 'examples', 'formats', name), 'utf8'));

describe('Sections — normalizeAddress', () => {
  it('accepts numbers, hex strings, "…h" and decimal strings', () => {
    assert.strictEqual(normalizeAddress(4096), 4096);
    assert.strictEqual(normalizeAddress('0x1000'), 4096);
    assert.strictEqual(normalizeAddress('1000h'), 4096);
    assert.strictEqual(normalizeAddress('4096'), 4096);
    assert.strictEqual(normalizeAddress(0), 0);
  });
  it('rejects negatives and garbage', () => {
    assert.strictEqual(normalizeAddress(-1), undefined);
    assert.strictEqual(normalizeAddress('nope'), undefined);
    assert.strictEqual(normalizeAddress(undefined), undefined);
  });
});

describe('Sections — buildSections from a definition', () => {
  const fmt: FormatDefinition = {
    name: 'map',
    sections: [
      { name: 'main', start: 0, length: 256, flags: 'rwx', display: true },
      { name: 'config', start: '0x100', end: '0x180' }, // length via end
      { name: 'ram', start: '0x20000000', length: 64, flags: 'rw-', display: false },
    ],
  };

  it('normalizes start/length/end and computes end/inFile', () => {
    const rows = buildSections(fmt, [], 1024);
    assert.strictEqual(rows.length, 3);

    assert.deepStrictEqual(
      rows.map((r) => [r.name, r.start, r.length, r.end, r.inFile]),
      [
        ['main', 0, 256, 256, true],
        ['config', 0x100, 0x80, 0x180, true],
        ['ram', 0x20000000, 64, 0x20000040, false], // start past a 1 KiB file
      ],
    );
    assert.strictEqual(rows.every((r) => r.source === 'defined'), true);
  });

  it('surfaces optional columns only when present', () => {
    const rows = buildSections(fmt, [], 1024);
    assert.strictEqual(hasFlagsColumn(rows), true);
    assert.strictEqual(hasDisplayColumn(rows), true);
    assert.strictEqual(rows[1].flags, undefined); // "config" defined neither
    assert.strictEqual(rows[1].display, undefined);

    const noExtras = buildSections(
      { name: 'x', sections: [{ name: 'a', start: 0, length: 8 }] },
      [],
      64,
    );
    assert.strictEqual(hasFlagsColumn(noExtras), false);
    assert.strictEqual(hasDisplayColumn(noExtras), false);
  });

  it('marks a section with an unparseable start as an error row', () => {
    const rows = buildSections(
      { name: 'x', sections: [{ name: 'bad', start: 'xyz', length: 4 }] },
      [],
      64,
    );
    assert.ok(rows[0].error);
    assert.strictEqual(rows[0].inFile, false);
  });
});

describe('Sections — fallback derivation from structure', () => {
  it('derives sections from top-level fields when the format has no `sections`', () => {
    const topNodes = [
      { name: 'Header', offset: 0, size: 8, depth: 0 },
      { name: 'Magic', offset: 0, size: 4, depth: 1 }, // nested — ignored
      { name: 'Body', offset: 8, size: 100, depth: 0 },
      { name: 'Marker', offset: 108, size: 0, depth: 0 }, // zero size — ignored
    ];
    const rows = buildSections({ name: 'f', fields: [] }, topNodes, 200);
    assert.deepStrictEqual(
      rows.map((r) => [r.name, r.start, r.length, r.source]),
      [
        ['Header', 0, 8, 'derived'],
        ['Body', 8, 100, 'derived'],
      ],
    );
  });
});

describe('Sections — schema validation', () => {
  it('accepts a sections-only format (no fields)', () => {
    const r = validateFormat({
      name: 'MemMap',
      sections: [
        { name: 'main', start: '0x0', length: '0x1000', flags: 'r-x', display: true },
        { name: 'data', start: 4096, end: 8192, flags: 'rw-', display: false },
      ],
    });
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.valid);
  });

  it('rejects a format with neither fields nor sections', () => {
    const r = validateFormat({ name: 'empty' });
    assert.ok(r.errors.some((e) => /"fields".*"sections"/.test(e)));
  });

  it('flags a bad start, missing length/end, bad flags and bad display', () => {
    const r = validateFormat({
      name: 'x',
      sections: [
        { name: 'a', start: -8, length: 4 },
        { name: 'b', start: 0 },
        { name: 'c', start: 0, length: 4, flags: 'read-write' },
        { name: 'd', start: 0, length: 4, display: 'yes' },
      ],
    });
    assert.ok(r.errors.some((e) => /sections\[0\]\.start/.test(e)));
    assert.ok(r.errors.some((e) => /sections\[1\].*"length" or "end"/.test(e)));
    assert.ok(r.errors.some((e) => /sections\[2\]\.flags/.test(e)));
    assert.ok(r.errors.some((e) => /sections\[3\]\.display/.test(e)));
  });

  it('accepts the shipped flash-layout.json and nested-firmware.json section lists', () => {
    assert.deepStrictEqual(validateFormat(readFormat('flash-layout.json')).errors, []);
    assert.deepStrictEqual(validateFormat(readFormat('nested-firmware.json')).errors, []);
  });
});
