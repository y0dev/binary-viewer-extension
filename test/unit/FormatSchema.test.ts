import * as assert from 'assert';
import { validateFormat, parseMagicBytes, validateFormatText } from '../../src/core/FormatSchema';
import { BUILTIN_FORMATS } from '../../src/formats/BuiltinFormats';

describe('FormatSchema.validateFormat', () => {
  it('accepts every builtin format', () => {
    for (const f of BUILTIN_FORMATS) {
      const r = validateFormat(f);
      assert.deepStrictEqual(r.errors, [], `${f.name}: ${r.errors.join('; ')}`);
      assert.ok(r.valid);
    }
  });

  it('rejects a format with no name', () => {
    const r = validateFormat({ fields: [{ name: 'a', type: 'uint8', offset: 0 }] });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /name/.test(e)));
  });

  it('rejects an unknown field type', () => {
    const r = validateFormat({ name: 'x', fields: [{ name: 'a', type: 'quad128', offset: 0 }] });
    assert.ok(r.errors.some((e) => /not a known type/.test(e)));
  });

  it('requires length/size for string and bytes types', () => {
    const r = validateFormat({
      name: 'x',
      fields: [
        { name: 's', type: 'ascii', offset: 0 },
        { name: 'b', type: 'bytes', offset: 4 },
      ],
    });
    assert.ok(r.errors.some((e) => /ascii/.test(e)));
    assert.ok(r.errors.some((e) => /bytes/.test(e)));
  });

  it('validates bit specs inside a flags field', () => {
    const r = validateFormat({
      name: 'x',
      fields: [
        {
          name: 'status',
          type: 'flags',
          offset: 0,
          size: 1,
          fields: [
            { name: 'A', bits: '0' },
            { name: 'B', bits: '8' },
          ],
        },
      ],
    });
    assert.ok(r.errors.some((e) => /exceeds container width/.test(e)));
  });

  it('parses magic byte strings in several notations', () => {
    assert.deepStrictEqual(parseMagicBytes('46 57 01 00'), [0x46, 0x57, 0x01, 0x00]);
    assert.deepStrictEqual(parseMagicBytes('0x46,0x57'), [0x46, 0x57]);
    assert.deepStrictEqual(parseMagicBytes('7F454C46'.replace(/(..)/g, '$1 ').trim()), [0x7f, 0x45, 0x4c, 0x46]);
    assert.throws(() => parseMagicBytes('ZZ'));
  });
});

describe('FormatSchema.validateFormatText (for the Validate button)', () => {
  it('reports a JSON syntax error rather than throwing', () => {
    const r = validateFormatText('{ "name": "x", }not json');
    assert.strictEqual(r.ok, false);
    assert.ok(/Invalid JSON/.test(r.errors[0]));
  });

  it('accepts a single valid definition and returns its name', () => {
    const r = validateFormatText(
      JSON.stringify({ name: 'Hdr', fields: [{ name: 'm', type: 'uint32', offset: 0 }] }),
    );
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.names, ['Hdr']);
    assert.deepStrictEqual(r.errors, []);
  });

  it('validates an array of definitions with an index prefix on each message', () => {
    const r = validateFormatText(
      JSON.stringify([
        { name: 'Good', fields: [{ name: 'a', type: 'uint8', offset: 0 }] },
        { name: 'Bad', fields: [{ name: 'a', type: 'nope', offset: 0 }] },
      ]),
    );
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.names, ['Good', 'Bad']);
    assert.ok(r.errors.some((m) => m.startsWith('[1] ')));
  });

  it('surfaces warnings without failing validation', () => {
    const r = validateFormatText(
      JSON.stringify({
        name: 'x',
        sections: [{ name: 's', start: 0, length: 4, end: 8 }],
      }),
    );
    assert.strictEqual(r.ok, true);
    assert.ok(r.warnings.length >= 1);
  });
});

describe('FormatSchema.validateFormat — array view', () => {
  const withView = (view: unknown, count = 1000) => ({
    name: 'v',
    fields: [
      { name: 'xs', type: 'array', offset: 0, count, view, items: { name: 'i', type: 'uint8' } },
    ],
  });

  it('accepts a "start...end" string and a { start, end } object', () => {
    assert.ok(validateFormat(withView('20...35')).valid);
    assert.ok(validateFormat(withView({ start: 20, end: 35 })).valid);
    assert.ok(validateFormat(withView({ start: 20 })).valid);
  });

  it('rejects an unparseable view string or a non-string/non-object value', () => {
    assert.ok(!validateFormat(withView('twenty to thirty-five')).valid);
    assert.ok(!validateFormat(withView(42)).valid);
    assert.ok(!validateFormat(withView(['20', '35'])).valid);
  });

  it('rejects negative start/end in the object form', () => {
    assert.ok(!validateFormat(withView({ start: -1, end: 5 })).valid);
    assert.ok(!validateFormat(withView({ start: 0, end: -5 })).valid);
  });

  it('rejects "view" on a non-array field', () => {
    const r = validateFormat({
      name: 'v',
      fields: [{ name: 'x', type: 'uint32', offset: 0, view: '0...5' }],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /only applies to "array"/.test(e)));
  });

  it('warns (does not fail) when set on an array of 50 or fewer elements', () => {
    const r = validateFormat(withView('0...5', 20));
    assert.ok(r.valid);
    assert.ok(r.warnings.some((w) => /no visible effect/.test(w)));
  });

  it('does not warn past 50 elements', () => {
    const r = validateFormat(withView('0...5', 51));
    assert.ok(r.valid);
    assert.ok(!r.warnings.some((w) => /no visible effect/.test(w)));
  });
});

describe('FormatSchema.validateFormat — constants', () => {
  const withConstants = (constants: unknown) => ({
    name: 'c',
    constants,
    fields: [{ name: 'a', type: 'uint8', offset: 0 }],
  });

  it('accepts numbers and "+"-sum strings, including a chain of them', () => {
    const r = validateFormat(withConstants({ Mean: 10, Range: 5, Total: 'Mean + Range', Plus1: 'Total + 1' }));
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.valid);
  });

  it('rejects a non-object constants value', () => {
    assert.ok(!validateFormat(withConstants([1, 2])).valid);
    assert.ok(!validateFormat(withConstants('nope')).valid);
  });

  it('rejects an entry referencing an unknown name', () => {
    const r = validateFormat(withConstants({ Total: 'Rows + Cols' }));
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /constants\.Total/.test(e)));
  });

  it('rejects a circular constant reference', () => {
    const r = validateFormat(withConstants({ A: 'B + 1', B: 'A + 1' }));
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /circular/.test(e)));
  });

  it('a countField naming a constant does not warn as an unknown field', () => {
    const r = validateFormat({
      name: 'arr-const',
      constants: { Size: 4 },
      fields: [
        { name: 'xs', type: 'array', offset: 0, countField: 'Size', items: { name: 'i', type: 'uint8' } },
      ],
    });
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.valid);
  });
});

describe('FormatSchema.validateFormat — field id and offsetField', () => {
  it('accepts a field with a unique id', () => {
    const r = validateFormat({
      name: 'ids',
      fields: [{ name: 'Width Detection Word', id: 'widthWord', type: 'uint32', offset: 0 }],
    });
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.valid);
  });

  it('rejects an empty string id', () => {
    const r = validateFormat({
      name: 'ids',
      fields: [{ name: 'x', id: '  ', type: 'uint8', offset: 0 }],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /\.id must be a non-empty string/.test(e)));
  });

  it('rejects duplicate ids across top-level fields', () => {
    const r = validateFormat({
      name: 'dup-ids',
      fields: [
        { name: 'a', id: 'dup', type: 'uint8', offset: 0 },
        { name: 'b', id: 'dup', type: 'uint8', offset: 1 },
      ],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /Duplicate field id "dup"/.test(e)));
  });

  it('rejects a duplicate id shared between a top-level field and a structures body', () => {
    const r = validateFormat({
      name: 'dup-ids-struct',
      structures: {
        Rec: { fields: [{ name: 'b', id: 'dup', type: 'uint8', offset: 0 }] },
      },
      fields: [{ name: 'a', id: 'dup', type: 'uint8', offset: 0 }],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /Duplicate field id "dup"/.test(e)));
  });

  it('accepts "structs" (Binary File Designer) as an alias for "structures"', () => {
    const def: Record<string, unknown> = {
      name: 'alias',
      structs: { Vec: { fields: [{ name: 'x', type: 'uint8' }] } },
      fields: [{ name: 'v', type: 'Vec' }],
    };
    const r = validateFormat(def);
    assert.ok(r.valid, r.errors.join('; '));
    assert.ok(def.structures && !('structs' in def));
  });

  it('accepts an offsetField reference and warns when offset is also set', () => {
    const ok = validateFormat({
      name: 'off1',
      fields: [
        { name: 'ihtOffset', type: 'uint32', offset: 0 },
        { name: 'iht', type: 'uint8', offsetField: 'ihtOffset' },
      ],
    });
    assert.deepStrictEqual(ok.errors, []);
    assert.ok(ok.valid);

    const both = validateFormat({
      name: 'off2',
      fields: [{ name: 'x', type: 'uint8', offset: 4, offsetField: 'n' }],
    });
    assert.ok(both.valid);
    assert.ok(both.warnings.some((w) => /"offset" and "offsetField" both set/.test(w)));
  });

  it('rejects an empty string offsetField', () => {
    const r = validateFormat({
      name: 'off3',
      fields: [{ name: 'x', type: 'uint8', offsetField: '  ' }],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /"offsetField" must be a non-empty string/.test(e)));
  });
});

describe('FormatSchema.validateFormat — array until', () => {
  const withUntil = (until: unknown) => ({
    name: 'u',
    fields: [
      {
        name: 'xs',
        type: 'array',
        offset: 0,
        count: 5,
        until,
        items: { name: 'i', fields: [{ name: 'next', id: 'next', type: 'uint8', offset: 0 }] },
      },
    ],
  });

  it('accepts { field } (equals defaults) and { field, equals }', () => {
    assert.deepStrictEqual(validateFormat(withUntil({ field: 'next' })).errors, []);
    assert.deepStrictEqual(validateFormat(withUntil({ field: 'next', equals: 0xff })).errors, []);
  });

  it('rejects a non-object, or an object missing a non-empty "field"', () => {
    assert.ok(!validateFormat(withUntil('next')).valid);
    assert.ok(!validateFormat(withUntil({})).valid);
    assert.ok(!validateFormat(withUntil({ field: '  ' })).valid);
  });

  it('rejects a non-number "equals"', () => {
    const r = validateFormat(withUntil({ field: 'next', equals: '0' }));
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /until\.equals must be a number/.test(e)));
  });

  it('rejects "until" on a non-array field', () => {
    const r = validateFormat({
      name: 'u2',
      fields: [{ name: 'x', type: 'uint32', offset: 0, until: { field: 'next' } }],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /only applies to "array"/.test(e)));
  });
});

describe('FormatSchema.validateFormat — cstring and sizeAlign', () => {
  it('accepts a plain cstring and one with terminator/wordSize/maxLength', () => {
    const r = validateFormat({
      name: 'c1',
      fields: [
        { name: 'a', type: 'cstring', offset: 0 },
        { name: 'b', type: 'cstring', offset: 4, terminator: 0xff, wordSize: 4, maxLength: 256 },
      ],
    });
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.valid);
  });

  it('rejects an out-of-range terminator, and a non-positive wordSize/maxLength', () => {
    const bad = (extra: object) =>
      validateFormat({ name: 'c2', fields: [{ name: 'a', type: 'cstring', offset: 0, ...extra }] });
    assert.ok(!bad({ terminator: 256 }).valid);
    assert.ok(!bad({ terminator: -1 }).valid);
    assert.ok(!bad({ wordSize: 0 }).valid);
    assert.ok(!bad({ maxLength: 0 }).valid);
  });

  it('rejects terminator/wordSize/maxLength on a non-cstring field', () => {
    const r = validateFormat({
      name: 'c3',
      fields: [{ name: 'a', type: 'uint32', offset: 0, wordSize: 4 }],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /"wordSize" only applies to "cstring"/.test(e)));
  });

  it('accepts sizeAlign on a structure and warns when size is also set', () => {
    const ok = validateFormat({
      name: 's1',
      fields: [{ name: 'rec', offset: 0, sizeAlign: 64, fields: [{ name: 'x', type: 'uint8', offset: 0 }] }],
    });
    assert.deepStrictEqual(ok.errors, []);

    const both = validateFormat({
      name: 's2',
      fields: [
        { name: 'rec', offset: 0, size: 32, sizeAlign: 64, fields: [{ name: 'x', type: 'uint8', offset: 0 }] },
      ],
    });
    assert.ok(both.valid);
    assert.ok(both.warnings.some((w) => /"size" and "sizeAlign" both set/.test(w)));
  });

  it('rejects a non-positive sizeAlign on a structure', () => {
    const r = validateFormat({
      name: 's3',
      fields: [{ name: 'rec', offset: 0, sizeAlign: 0, fields: [{ name: 'x', type: 'uint8', offset: 0 }] }],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /sizeAlign must be a positive integer/.test(e)));
  });

  it('rejects sizeAlign on a plain (non-structure) field', () => {
    const r = validateFormat({
      name: 's4',
      fields: [{ name: 'a', type: 'uint32', offset: 0, sizeAlign: 4 }],
    });
    assert.ok(!r.valid);
    assert.ok(r.errors.some((e) => /"sizeAlign" only applies to a structure/.test(e)));
  });
});
