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
