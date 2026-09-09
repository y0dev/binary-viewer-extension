import * as assert from 'assert';
import { detectFormats, magicMatches } from '../../src/core/FormatDetector';
import type { FormatDefinition } from '../../src/types/format';

const fwByExt: FormatDefinition = {
  name: 'FW by extension',
  fileExtensions: ['.fw', 'img'],
  fields: [{ name: 'x', type: 'uint8', offset: 0 }],
};

const fwByMagic: FormatDefinition = {
  name: 'FW by magic',
  magic: { offset: 0, bytes: '46 57 01 00' },
  fields: [{ name: 'x', type: 'uint8', offset: 0 }],
};

const fwBoth: FormatDefinition = {
  name: 'FW by both',
  fileExtensions: ['.fw'],
  magic: { offset: 0, bytes: '46 57' },
  fields: [{ name: 'x', type: 'uint8', offset: 0 }],
};

const header = Uint8Array.from([0x46, 0x57, 0x01, 0x00, 0xaa, 0xbb]);

describe('FormatDetector', () => {
  it('matches by file extension (with or without dot)', () => {
    const hits = detectFormats([fwByExt], 'device.fw', Uint8Array.from([0, 0, 0, 0]));
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].format.name, 'FW by extension');
  });

  it('matches by magic bytes', () => {
    const hits = detectFormats([fwByMagic], 'device.unknown', header);
    assert.strictEqual(hits.length, 1);
  });

  it('supports a bitmask on magic', () => {
    assert.ok(magicMatches({ offset: 0, bytes: '46 50', mask: 'FF F0' }, Uint8Array.from([0x46, 0x57])));
    assert.ok(!magicMatches({ offset: 0, bytes: '46 40', mask: 'FF F0' }, Uint8Array.from([0x46, 0x57])));
  });

  it('disqualifies a format that declares magic which does not match', () => {
    const hits = detectFormats([fwByMagic], 'device.fw', Uint8Array.from([0, 0, 0, 0]));
    assert.strictEqual(hits.length, 0);
  });

  it('ranks magic+extension above magic above extension when several match', () => {
    const hits = detectFormats([fwByExt, fwByMagic, fwBoth], 'device.fw', header);
    assert.deepStrictEqual(
      hits.map((h) => h.format.name),
      ['FW by both', 'FW by magic', 'FW by extension'],
    );
  });

  it('returns nothing when no format matches', () => {
    const hits = detectFormats([fwByExt, fwByMagic], 'notes.txt', Uint8Array.from([1, 2, 3]));
    assert.strictEqual(hits.length, 0);
  });
});
