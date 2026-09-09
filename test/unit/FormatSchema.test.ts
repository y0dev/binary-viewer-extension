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
