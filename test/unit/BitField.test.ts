import * as assert from 'assert';
import {
  parseBitRange,
  validateBitSpecs,
  extractBits,
  decodeBits,
} from '../../src/core/BitField';
import type { BitSpec } from '../../src/types/format';

describe('BitField', () => {
  it('parses single bits and ranges order-insensitively', () => {
    assert.deepStrictEqual(parseBitRange('0'), { lo: 0, hi: 0, width: 1 });
    assert.deepStrictEqual(parseBitRange('4'), { lo: 4, hi: 4, width: 1 });
    assert.deepStrictEqual(parseBitRange('1-3'), { lo: 1, hi: 3, width: 3 });
    assert.deepStrictEqual(parseBitRange('3-1'), { lo: 1, hi: 3, width: 3 });
    assert.deepStrictEqual(parseBitRange(' 5 : 7 '), { lo: 5, hi: 7, width: 3 });
  });

  it('rejects malformed specs', () => {
    assert.throws(() => parseBitRange('abc'));
    assert.throws(() => parseBitRange('1-'));
    assert.throws(() => parseBitRange(''));
  });

  it('extracts bit values from a container (boundary bits included)', () => {
    // 0b1010_0101 = 0xA5
    assert.strictEqual(extractBits(0xa5, parseBitRange('0')), 1);
    assert.strictEqual(extractBits(0xa5, parseBitRange('1')), 0);
    assert.strictEqual(extractBits(0xa5, parseBitRange('7')), 1); // MSB boundary
    assert.strictEqual(extractBits(0xa5, parseBitRange('1-3')), 0b010);
    assert.strictEqual(extractBits(0xa5, parseBitRange('4-7')), 0b1010);
  });

  it('extracts across the 32-bit boundary using bigint math', () => {
    const container = 0xffffffffn; // 32 bits set
    assert.strictEqual(extractBits(container, parseBitRange('31')), 1n);
    assert.strictEqual(extractBits(container, parseBitRange('28-31')), 0b1111n);
  });

  it('flags overlapping and out-of-range bit specs', () => {
    const specs: BitSpec[] = [
      { name: 'A', bits: '0-3' },
      { name: 'B', bits: '2-5' }, // overlaps A at bits 2,3
      { name: 'C', bits: '9' }, // out of range for an 8-bit container
    ];
    const errors = validateBitSpecs(specs, 8);
    assert.ok(errors.some((e) => /overlaps/.test(e)));
    assert.ok(errors.some((e) => /exceeds container width/.test(e)));
  });

  it('accepts a valid, non-overlapping, full-width partition', () => {
    const specs: BitSpec[] = [
      { name: 'Enabled', bits: '0' },
      { name: 'Mode', bits: '1-3' },
      { name: 'Error', bits: '4' },
      { name: 'Reserved', bits: '5-7' },
    ];
    assert.deepStrictEqual(validateBitSpecs(specs, 8), []);
  });

  it('decodes the documented Status example (0x15)', () => {
    const specs: BitSpec[] = [
      { name: 'Enabled', bits: '0' },
      { name: 'Mode', bits: '1-3' },
      { name: 'Error', bits: '4' },
      { name: 'Reserved', bits: '5-7' },
    ];
    const decoded = decodeBits(0x15, specs); // 0b0001_0101
    const byName = Object.fromEntries(decoded.map((d) => [d.name, d.display]));
    assert.strictEqual(byName.Enabled, 'true');
    assert.strictEqual(byName.Mode, '2');
    assert.strictEqual(byName.Error, 'true');
    assert.strictEqual(byName.Reserved, '0');
  });

  it('applies an enum overlay on a bit range', () => {
    const decoded = decodeBits(0b0100_0000, [
      { name: 'Stage', bits: '4-6', enum: { '0': 'boot', '1': 'app', '4': 'recovery' } },
    ]);
    assert.strictEqual(decoded[0].display, 'recovery (4)');
  });
});
