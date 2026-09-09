import * as assert from 'assert';
import { resolveStructures } from '../../src/core/FormatResolve';
import { parseFormat } from '../../src/core/BinaryParser';
import { validateFormat } from '../../src/core/FormatSchema';
import type { FormatDefinition } from '../../src/types/format';
import type { ParsedNode } from '../../src/types/messages';

describe('FormatResolve.resolveStructures', () => {
  it('leaves plain fields unchanged when there are no `structures` or shorthand', () => {
    const fmt: FormatDefinition = {
      name: 'x',
      fields: [{ name: 'a', type: 'uint32', offset: 0 }],
    };
    const { format, errors } = resolveStructures(fmt);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(format.structures, undefined);
    assert.deepStrictEqual(format.fields, fmt.fields);
  });

  it('expands "float32[8]" shorthand into a real array field', () => {
    const fmt: FormatDefinition = {
      name: 'x',
      fields: [{ name: 'coeffs', type: 'float32[8]', offset: 16 }],
    };
    const { format } = resolveStructures(fmt);
    const f = format.fields![0];
    assert.strictEqual(f.type, 'array');
    assert.strictEqual(f.count, 8);
    assert.strictEqual(f.offset, 16);
    assert.deepStrictEqual(f.items, { name: 'item', type: 'float32' });
  });

  it('inlines a struct reference used directly by a field', () => {
    const fmt: FormatDefinition = {
      name: 'x',
      structures: {
        Point: { fields: [{ name: 'x', type: 'int16', offset: 0 }, { name: 'y', type: 'int16', offset: 2 }] },
      },
      fields: [{ name: 'origin', type: 'Point', offset: 8 }],
    };
    const { format, errors } = resolveStructures(fmt);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(format.structures, undefined);
    const origin = format.fields![0];
    assert.strictEqual(origin.type, undefined);
    assert.ok(Array.isArray(origin.fields));
    assert.strictEqual(origin.offset, 8);
    assert.deepStrictEqual((origin.fields as { name: string }[]).map((f) => f.name), ['x', 'y']);
  });

  it('inlines a struct reference used as an array element', () => {
    const fmt: FormatDefinition = {
      name: 'x',
      structures: { Rec: { fields: [{ name: 'v', type: 'uint32', offset: 0 }] } },
      fields: [{ name: 'rows', type: 'array', offset: 0, count: 3, items: { name: 'item', type: 'Rec' } }],
    };
    const { format } = resolveStructures(fmt);
    const items = format.fields![0].items!;
    assert.strictEqual(items.type, undefined);
    assert.ok(Array.isArray(items.fields));
  });

  it('resolves a struct that references another struct', () => {
    const fmt: FormatDefinition = {
      name: 'x',
      structures: {
        Inner: { fields: [{ name: 'a', type: 'uint8', offset: 0 }] },
        Outer: { fields: [{ name: 'inner', type: 'Inner', offset: 0 }, { name: 'b', type: 'uint8', offset: 1 }] },
      },
      fields: [{ name: 'root', type: 'Outer', offset: 0 }],
    };
    const { format, errors } = resolveStructures(fmt);
    assert.deepStrictEqual(errors, []);
    const root = format.fields![0];
    const inner = (root.fields as { name: string; fields?: unknown }[]).find((f) => f.name === 'inner')!;
    assert.ok(Array.isArray(inner.fields));
  });

  it('reports a recursive reference instead of looping forever', () => {
    const fmt: FormatDefinition = {
      name: 'x',
      structures: {
        A: { fields: [{ name: 'b', type: 'B', offset: 0 }] },
        B: { fields: [{ name: 'a', type: 'A', offset: 0 }] },
      },
      fields: [{ name: 'root', type: 'A', offset: 0 }],
    };
    const { errors } = resolveStructures(fmt);
    assert.ok(errors.some((e) => /Recursive structure reference/.test(e)));
  });

  it('end-to-end: a named-structure array decodes the same as an inline one', () => {
    const bytes = new Uint8Array(24);
    for (let i = 0; i < 24; i++) {
      bytes[i] = i;
    }
    const fmt: FormatDefinition = {
      name: 'records',
      structures: {
        Sample: {
          fields: [
            { name: 'id', type: 'uint16', offset: 0 },
            { name: 'value', type: 'uint16', offset: 2 },
          ],
        },
      },
      fields: [
        { name: 'rows', type: 'array', offset: 0, count: 6, items: { name: 'item', type: 'Sample' } },
      ],
    };
    assert.deepStrictEqual(validateFormat(fmt).errors, []);
    const { format } = resolveStructures(fmt);
    const { nodes, error } = parseFormat(
      format,
      { baseOffset: 0, bytes, fileSize: bytes.length },
      { defaultEndianness: 'little' },
    );
    assert.strictEqual(error, undefined);
    const ids = nodes.filter((n: ParsedNode) => n.name === 'id');
    assert.strictEqual(ids.length, 6);
    assert.deepStrictEqual(ids.map((n) => n.offset), [0, 4, 8, 12, 16, 20]);
    assert.strictEqual(ids[1].value, String(4 + 5 * 256)); // bytes[4], bytes[5] LE
  });
});

describe('FormatSchema — structures map validation', () => {
  it('accepts a valid structures map + reference', () => {
    const r = validateFormat({
      name: 'x',
      structures: { Rec: { fields: [{ name: 'v', type: 'uint32', offset: 0 }] } },
      fields: [{ name: 'a', type: 'Rec', offset: 0 }],
    });
    assert.deepStrictEqual(r.errors, []);
  });

  it('rejects a reference to an unknown structure', () => {
    const r = validateFormat({
      name: 'x',
      structures: { Rec: { fields: [{ name: 'v', type: 'uint32', offset: 0 }] } },
      fields: [{ name: 'a', type: 'Missing', offset: 0 }],
    });
    assert.ok(r.errors.some((e) => /not a known type or a defined structure/.test(e)));
  });

  it('rejects a structures map that is not an object of { fields }', () => {
    assert.ok(
      validateFormat({ name: 'x', structures: [], fields: [{ name: 'a', type: 'uint8', offset: 0 }] })
        .errors.some((e) => /"structures" must be an object/.test(e)),
    );
    assert.ok(
      validateFormat({
        name: 'x',
        structures: { Bad: { fields: [] } },
        fields: [{ name: 'a', type: 'uint8', offset: 0 }],
      }).errors.some((e) => /fields must be a non-empty array/.test(e)),
    );
  });

  it('detects a cycle in the structures graph', () => {
    const r = validateFormat({
      name: 'x',
      structures: {
        A: { fields: [{ name: 'b', type: 'B', offset: 0 }] },
        B: { fields: [{ name: 'a', type: 'A', offset: 0 }] },
      },
      fields: [{ name: 'root', type: 'A', offset: 0 }],
    });
    assert.ok(r.errors.some((e) => /Recursive structure reference/.test(e)));
  });
});
