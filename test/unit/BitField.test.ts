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
    assert.deepStrictEqual(parseBitRange('0'), { parts: [{ lo: 0, hi: 0 }], lo: 0, hi: 0, width: 1 });
    assert.deepStrictEqual(parseBitRange('4'), { parts: [{ lo: 4, hi: 4 }], lo: 4, hi: 4, width: 1 });
    assert.deepStrictEqual(parseBitRange('1-3'), { parts: [{ lo: 1, hi: 3 }], lo: 1, hi: 3, width: 3 });
    assert.deepStrictEqual(parseBitRange('3-1'), { parts: [{ lo: 1, hi: 3 }], lo: 1, hi: 3, width: 3 });
    assert.deepStrictEqual(parseBitRange(' 5 : 7 '), { parts: [{ lo: 5, hi: 7 }], lo: 5, hi: 7, width: 3 });
  });

  it('rejects malformed specs', () => {
    assert.throws(() => parseBitRange('abc'));
    assert.throws(() => parseBitRange('1-'));
    assert.throws(() => parseBitRange(''));
    assert.throws(() => parseBitRange('0-5,'));
    assert.throws(() => parseBitRange('0-5,abc'));
  });

  it('parses a comma-separated multi-part spec (non-contiguous bits combined into one field)', () => {
    const r = parseBitRange('0-5,12-13,16-31');
    assert.deepStrictEqual(r.parts, [
      { lo: 0, hi: 5 },
      { lo: 12, hi: 13 },
      { lo: 16, hi: 31 },
    ]);
    assert.strictEqual(r.lo, 0);
    assert.strictEqual(r.hi, 31);
    assert.strictEqual(r.width, 6 + 2 + 16);
  });

  it('extracts and concatenates a multi-part spec, first part as the low bits', () => {
    // parts: bits 0-1 = 0b11, bits 4-5 = 0b10 -> combined = 0b10_11 = 11
    const raw = 0b0010_0011; // bit0=1,bit1=1,bit4=0,bit5=1
    assert.strictEqual(extractBits(raw, parseBitRange('0-1,4-5')), 0b1011);
  });

  it('flags a Zynq-style Reserved spec ("0-5,12-13,16-31") as tiling the container without overlap', () => {
    const specs: BitSpec[] = [
      { name: 'Reserved0', bits: '0-5' },
      { name: 'PUF-HD', bits: '6-7' },
      { name: 'Hashing', bits: '8-9' },
      { name: 'CPU Select', bits: '10-11' },
      { name: 'Reserved1', bits: '12-13' },
      { name: 'BHDR RSA', bits: '14-15' },
      { name: 'Reserved2', bits: '16-31' },
    ];
    assert.deepStrictEqual(validateBitSpecs(specs, 32), []);

    // Now the same shape, but the three "Reserved" pieces are one combined spec.
    const combined: BitSpec[] = [
      { name: 'PUF-HD', bits: '6-7' },
      { name: 'Hashing', bits: '8-9' },
      { name: 'CPU Select', bits: '10-11' },
      { name: 'BHDR RSA', bits: '14-15' },
      { name: 'Reserved', bits: '0-5,12-13,16-31' },
    ];
    assert.deepStrictEqual(validateBitSpecs(combined, 32), []);
  });

  it('still catches an overlap against one part of a multi-part spec', () => {
    const specs: BitSpec[] = [
      { name: 'Reserved', bits: '0-5,16-31' },
      { name: 'Other', bits: '4' }, // overlaps the 0-5 part
    ];
    const errors = validateBitSpecs(specs, 32);
    assert.ok(errors.some((e) => /overlaps/.test(e)));
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
