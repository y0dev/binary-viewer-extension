import * as assert from 'assert';
import { reorderFormatKeys, FORMAT_KEY_ORDER } from '../../src/core/FormatOrder';
import type { FormatDefinition } from '../../src/types/format';

describe('reorderFormatKeys', () => {
  it('puts name first and fields last, regardless of input order', () => {
    const def = {
      fields: [{ name: 'a', type: 'uint8', offset: 0 }],
      magic: { offset: 0, bytes: '46 57' },
      description: 'a format',
      endianness: 'little',
      name: 'Example',
      fileExtensions: ['.fw'],
    } as FormatDefinition;

    const keys = Object.keys(reorderFormatKeys(def));
    assert.strictEqual(keys[0], 'name');
    assert.strictEqual(keys[keys.length - 1], 'fields');
    assert.deepStrictEqual(keys, ['name', 'endianness', 'description', 'fileExtensions', 'magic', 'fields']);
  });

  it('follows FORMAT_KEY_ORDER exactly for a fully-populated definition', () => {
    const def: FormatDefinition = {
      name: 'x',
      endianness: 'little',
      description: 'd',
      version: '1.0',
      author: 'me',
      fileExtensions: ['.x'],
      magic: { offset: 0, bytes: '00' },
      baseAddress: '0x08000000',
      constants: { Rows: 4 },
      structures: { Rec: { fields: [] } },
      sections: [{ name: 's', start: 0, length: 4 }],
      fields: [],
    };
    assert.deepStrictEqual(Object.keys(reorderFormatKeys(def)), FORMAT_KEY_ORDER as string[]);
  });

  it('omits keys that are absent rather than emitting them as undefined', () => {
    const def: FormatDefinition = { name: 'x', fields: [] };
    assert.deepStrictEqual(Object.keys(reorderFormatKeys(def)), ['name', 'fields']);
  });

  it('keeps an unrecognised key rather than dropping it, appended after the known ones', () => {
    const def = { name: 'x', fields: [], extra: 'kept' } as unknown as FormatDefinition;
    const keys = Object.keys(reorderFormatKeys(def));
    assert.deepStrictEqual(keys, ['name', 'fields', 'extra']);
  });

  it('the JSON.stringify output reflects the same order', () => {
    const def = { fields: [], name: 'x', description: 'd' } as FormatDefinition;
    const json = JSON.stringify(reorderFormatKeys(def));
    assert.ok(json.indexOf('"name"') < json.indexOf('"description"'));
    assert.ok(json.indexOf('"description"') < json.indexOf('"fields"'));
  });
});
