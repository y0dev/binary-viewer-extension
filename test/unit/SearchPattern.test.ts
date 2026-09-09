import * as assert from 'assert';
import {
  compileSearch,
  scanBuffer,
  parseHexPattern,
  parseBitPattern,
} from '../../src/core/SearchPattern';

describe('SearchPattern', () => {
  it('parses spaced and contiguous hex, with wildcards', () => {
    assert.deepStrictEqual(parseHexPattern('FF 00 A5 10').bytes, [0xff, 0x00, 0xa5, 0x10]);
    assert.deepStrictEqual(parseHexPattern('ff00a510').bytes, [0xff, 0x00, 0xa5, 0x10]);
    const wild = parseHexPattern('FF ?? 10');
    assert.deepStrictEqual(wild.bytes, [0xff, 0x00, 0x10]);
    assert.deepStrictEqual(wild.mask, [0xff, 0x00, 0xff]);
    const nib = parseHexPattern('F?');
    assert.deepStrictEqual(nib.mask, [0xf0]);
  });

  it('parses bit patterns (multiple of 8, with ?)', () => {
    const p = parseBitPattern('1010 0101');
    assert.deepStrictEqual(p.bytes, [0xa5]);
    assert.deepStrictEqual(p.mask, [0xff]);
    const q = parseBitPattern('1?1?0?0?');
    assert.deepStrictEqual(q.mask, [0b10101010]);
    assert.throws(() => parseBitPattern('101'));
  });

  it('finds a hex needle at all offsets across a buffer', () => {
    const buf = Uint8Array.from([0, 0xff, 0x00, 0xa5, 0x10, 9, 0xff, 0x00, 0xa5, 0x10]);
    const pat = compileSearch({ kind: 'hex', text: 'FF 00 A5 10', from: 0, direction: 'all' });
    assert.deepStrictEqual(scanBuffer(pat, buf, 0), [1, 6]);
  });

  it('honours wildcards while scanning', () => {
    const buf = Uint8Array.from([0x11, 0x22, 0x33, 0x11, 0x99, 0x33]);
    const pat = compileSearch({ kind: 'hex', text: '11 ?? 33', from: 0, direction: 'all' });
    assert.deepStrictEqual(scanBuffer(pat, buf, 100), [100, 103]);
  });

  it('does case-insensitive ASCII search', () => {
    const buf = new TextEncoder().encode('the HELLO world hello');
    const ci = compileSearch({ kind: 'ascii', text: 'hello', caseInsensitive: true, from: 0, direction: 'all' });
    assert.deepStrictEqual(scanBuffer(ci, buf, 0), [4, 16]);
    const cs = compileSearch({ kind: 'ascii', text: 'hello', from: 0, direction: 'all' });
    assert.deepStrictEqual(scanBuffer(cs, buf, 0), [16]);
  });

  it('encodes utf16 needles little-endian', () => {
    const pat = compileSearch({ kind: 'utf16', text: 'Hi', from: 0, direction: 'all' });
    const buf = Uint8Array.from([0x00, 0x48, 0x00, 0x69, 0x00]);
    assert.deepStrictEqual(scanBuffer(pat, buf, 0), [1]);
  });

  it('respects the limit option', () => {
    const buf = new Uint8Array(20).fill(0xab);
    const pat = compileSearch({ kind: 'hex', text: 'AB', from: 0, direction: 'all' });
    assert.strictEqual(scanBuffer(pat, buf, 0, { limit: 3 }).length, 3);
  });
});
