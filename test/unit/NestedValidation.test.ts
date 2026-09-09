import * as assert from 'assert';
import { validateFormat } from '../../src/core/FormatSchema';

function errs(fmt: unknown): string[] {
  return validateFormat(fmt).errors;
}

describe('Nested structures — validation', () => {
  it('accepts a valid nested format', () => {
    const r = validateFormat({
      name: 'ok',
      fields: [
        {
          name: 'Header',
          offset: 0,
          fields: [
            { name: 'Magic', type: 'uint32', offset: 0 },
            { name: 'Version', type: 'uint16', offset: 4 },
          ],
        },
        { name: 'Checksum', type: 'uint32', offset: 20 },
      ],
    });
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.valid);
  });

  it('rejects a field that declares BOTH a type and nested fields', () => {
    const e = errs({
      name: 'x',
      fields: [{ name: 'Invalid', type: 'uint32', fields: [] }],
    });
    assert.ok(e.some((m) => /both a type .* and nested fields/i.test(m)), e.join('\n'));
  });

  it('rejects a field that declares a type and non-empty nested fields', () => {
    const e = errs({
      name: 'x',
      fields: [
        {
          name: 'Invalid',
          type: 'uint32',
          fields: [{ name: 'a', type: 'uint8', offset: 0 }],
        },
      ],
    });
    assert.ok(e.some((m) => /both a type/i.test(m)));
  });

  it('rejects a field that declares NEITHER a type nor nested fields', () => {
    const e = errs({ name: 'x', fields: [{ name: 'Lonely', offset: 0 }] });
    assert.ok(e.some((m) => /must define either a type or nested fields/i.test(m)), e.join('\n'));
  });

  it('still accepts the bit-field form (type + { bits } entries)', () => {
    const r = validateFormat({
      name: 'x',
      fields: [
        {
          name: 'Status',
          type: 'uint8',
          offset: 0,
          fields: [
            { name: 'Enabled', bits: '0' },
            { name: 'Mode', bits: '1-3' },
          ],
        },
      ],
    });
    assert.deepStrictEqual(r.errors, []);
  });

  it('flags a negative structure offset', () => {
    const e = errs({
      name: 'x',
      fields: [{ name: 'Header', offset: -4, fields: [{ name: 'a', type: 'uint8', offset: 0 }] }],
    });
    assert.ok(e.some((m) => /structure "Header" has an invalid offset/i.test(m)), e.join('\n'));
  });

  it('flags a negative child offset', () => {
    const e = errs({
      name: 'x',
      fields: [{ name: 'Header', offset: 0, fields: [{ name: 'a', type: 'uint8', offset: -1 }] }],
    });
    assert.ok(e.some((m) => /field "a" has an invalid offset/i.test(m)), e.join('\n'));
  });

  it('detects overlapping fields inside a structure', () => {
    const e = errs({
      name: 'x',
      fields: [
        {
          name: 'Header',
          offset: 0,
          fields: [
            { name: 'A', type: 'uint32', offset: 0 }, // 0..4
            { name: 'B', type: 'uint32', offset: 2 }, // 2..6  -> overlaps A
          ],
        },
      ],
    });
    assert.ok(
      e.some((m) => /structure "Header" contains overlapping fields \("A" and "B"\)/i.test(m)),
      e.join('\n'),
    );
  });

  it('detects a field extending beyond the declared structure size', () => {
    const e = errs({
      name: 'x',
      fields: [
        {
          name: 'Header',
          offset: 0,
          size: 6,
          fields: [
            { name: 'Version', type: 'uint32', offset: 0 }, // 0..4 ok
            { name: 'Extra', type: 'uint32', offset: 4 }, // 4..8 -> beyond size 6
          ],
        },
      ],
    });
    assert.ok(
      e.some((m) => /field "Extra" extends beyond the declared size of structure "Header"/i.test(m)),
      e.join('\n'),
    );
  });

  it('reports errors for deeply nested invalid children', () => {
    const e = errs({
      name: 'x',
      fields: [
        {
          name: 'Outer',
          offset: 0,
          fields: [
            {
              name: 'Inner',
              offset: 0,
              fields: [{ name: 'bad', type: 'not_a_type', offset: 0 }],
            },
          ],
        },
      ],
    });
    assert.ok(e.some((m) => /not a known type/i.test(m)), e.join('\n'));
  });

  it('requires a structure to contain at least one field', () => {
    const e = errs({ name: 'x', fields: [{ name: 'Empty', offset: 0, fields: [] }] });
    assert.ok(e.some((m) => /structure "Empty" must contain at least one field/i.test(m)), e.join('\n'));
  });
});
