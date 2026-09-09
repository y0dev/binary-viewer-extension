import * as assert from 'assert';
import { parseArrayShorthand, expandShorthandField, expandShorthandDeep } from '../../src/core/FieldSyntax';
import { computeFieldSize } from '../../src/core/BinaryField';
import { parseFormat } from '../../src/core/BinaryParser';
import { validateFormat } from '../../src/core/FormatSchema';
import type { FieldDefinition, FormatDefinition } from '../../src/types/format';
import type { ParsedNode } from '../../src/types/messages';

describe('FieldSyntax.parseArrayShorthand', () => {
  it('recognises `<base>[<n>]`', () => {
    assert.deepStrictEqual(parseArrayShorthand('float32[8]'), { base: 'float32', count: 8 });
    assert.deepStrictEqual(parseArrayShorthand('int16[24]'), { base: 'int16', count: 24 });
    assert.deepStrictEqual(parseArrayShorthand(' uint8 [ 16 ] '), { base: 'uint8', count: 16 });
    assert.deepStrictEqual(parseArrayShorthand('My Struct[100]'), { base: 'My Struct', count: 100 });
  });
  it('ignores non-shorthand', () => {
    assert.strictEqual(parseArrayShorthand('float32'), null);
    assert.strictEqual(parseArrayShorthand('array'), null);
    assert.strictEqual(parseArrayShorthand('uint8[]'), null);
    assert.strictEqual(parseArrayShorthand(undefined), null);
  });
});

describe('FieldSyntax.expandShorthandField', () => {
  it('turns a scalar shorthand into an array field, keeping name/offset', () => {
    const f = expandShorthandField({ name: 'coeffs', type: 'float32[8]', offset: 4 });
    assert.strictEqual(f.type, 'array');
    assert.strictEqual(f.count, 8);
    assert.strictEqual(f.offset, 4);
    assert.deepStrictEqual(f.items, { name: 'item', type: 'float32' });
  });
  it('turns a struct-name shorthand into an array of that struct', () => {
    const f = expandShorthandField({ name: 'rows', type: 'Sample[3]' });
    assert.deepStrictEqual(f.items, { name: 'item', type: 'Sample' });
    assert.strictEqual(f.count, 3);
  });
  it('maps char/ascii shorthand to a string length, not an array', () => {
    assert.deepStrictEqual(expandShorthandField({ name: 't', type: 'char[4]' }), {
      name: 't',
      type: 'char',
      length: 4,
    });
    assert.deepStrictEqual(expandShorthandField({ name: 's', type: 'ascii[16]' }), {
      name: 's',
      type: 'ascii',
      length: 16,
    });
  });
  it('maps bytes/binary shorthand to a size', () => {
    assert.deepStrictEqual(expandShorthandField({ name: 'r', type: 'bytes[12]' }), {
      name: 'r',
      type: 'bytes',
      size: 12,
    });
  });
  it('is a no-op for a normal field (returns the same object)', () => {
    const f: FieldDefinition = { name: 'x', type: 'uint32', offset: 0 };
    assert.strictEqual(expandShorthandField(f), f);
  });
  it('recurses through nested fields and array items', () => {
    const [f] = expandShorthandDeep([
      {
        name: 'h',
        fields: [
          { name: 'a', type: 'uint16', offset: 0 },
          { name: 'v', type: 'float32[4]', offset: 2 },
        ],
      },
    ]);
    const v = (f.fields as FieldDefinition[])[1];
    assert.strictEqual(v.type, 'array');
    assert.strictEqual(v.count, 4);
  });
});

describe('shorthand — sizing, validation, parsing', () => {
  it('computeFieldSize handles shorthand', () => {
    assert.strictEqual(computeFieldSize({ name: 'x', type: 'float32[8]' }), 32);
    assert.strictEqual(computeFieldSize({ name: 'x', type: 'int16[24]' }), 48);
    assert.strictEqual(computeFieldSize({ name: 'x', type: 'char[4]' }), 4);
    assert.strictEqual(computeFieldSize({ name: 'x', type: 'bytes[10]' }), 10);
  });

  it('validateFormat accepts shorthand and rejects a bad base', () => {
    assert.deepStrictEqual(
      validateFormat({ name: 'x', fields: [{ name: 'c', type: 'float32[8]', offset: 0 }] }).errors,
      [],
    );
    const bad = validateFormat({ name: 'x', fields: [{ name: 'c', type: 'notatype[8]', offset: 0 }] });
    assert.ok(bad.errors.some((e) => /not a known type/.test(e)));
  });

  it('parses `float32[8]` — 8 float elements at the right offsets', () => {
    const buf = new Uint8Array(8 + 8 * 4);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < 8; i++) {
      dv.setFloat32(8 + i * 4, i + 0.5, true);
    }
    const fmt: FormatDefinition = {
      name: 'x',
      fields: [
        { name: 'header', type: 'uint16', offset: 0 },
        { name: 'coeffs', type: 'float32[8]', offset: 8 },
      ],
    };
    const { nodes, error } = parseFormat(
      fmt,
      { baseOffset: 0, bytes: buf, fileSize: buf.length },
      { defaultEndianness: 'little' },
    );
    assert.strictEqual(error, undefined);
    const elems = nodes.filter((n: ParsedNode) => /^coeffs\[\d+\]$/.test(n.name));
    assert.strictEqual(elems.length, 8);
    assert.deepStrictEqual(elems.map((n) => n.offset), [8, 12, 16, 20, 24, 28, 32, 36]);
    assert.strictEqual(elems[0].value, '0.5');
    assert.strictEqual(elems[7].value, '7.5');
  });

  it('parses `Sample[4]` — array of a reusable structure via shorthand', () => {
    const buf = new Uint8Array(4 * 4);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < 4; i++) {
      dv.setUint16(i * 4, 100 + i, true);
      dv.setInt16(i * 4 + 2, -i, true);
    }
    const fmt: FormatDefinition = {
      name: 'x',
      structures: {
        Sample: {
          fields: [
            { name: 'id', type: 'uint16', offset: 0 },
            { name: 'd', type: 'int16', offset: 2 },
          ],
        },
      },
      fields: [{ name: 'rows', type: 'Sample[4]', offset: 0 }],
    };
    assert.deepStrictEqual(validateFormat(fmt).errors, []);
    // resolveStructures is what the host runs before parseFormat:
    const { resolveStructures } = require('../../src/core/FormatResolve');
    const { format } = resolveStructures(fmt);
    const { nodes, error } = parseFormat(
      format,
      { baseOffset: 0, bytes: buf, fileSize: buf.length },
      { defaultEndianness: 'little' },
    );
    assert.strictEqual(error, undefined);
    const ids = nodes.filter((n: ParsedNode) => n.name === 'id');
    assert.strictEqual(ids.length, 4);
    assert.deepStrictEqual(ids.map((n) => n.offset), [0, 4, 8, 12]);
    assert.strictEqual(ids[0].value, '100');
  });
});
