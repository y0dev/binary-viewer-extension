import * as assert from 'assert';
import {
  scaffoldWholeFile,
  scaffoldArray,
  scaffoldSingleField,
  suggestElementSize,
} from '../../src/core/FormatScaffold';
import { validateFormat } from '../../src/core/FormatSchema';
import { parseFormat } from '../../src/core/BinaryParser';
import type { ParsedNode } from '../../src/types/messages';

function bytes(n: number, fill = (i: number) => i & 0xff): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = fill(i);
  }
  return b;
}

describe('FormatScaffold', () => {
  it('suggestElementSize returns a divisor of the total', () => {
    assert.strictEqual(suggestElementSize(4096), 16);
    assert.strictEqual(suggestElementSize(24), 8);
    assert.strictEqual(suggestElementSize(7), 1);
    for (const n of [4096, 24, 100, 999, 7]) {
      assert.strictEqual(n % suggestElementSize(n), 0, `size for ${n} should divide it`);
    }
  });

  it('scaffoldWholeFile produces a valid skeleton with magic + header + body', () => {
    const def = scaffoldWholeFile({
      name: 'Draft',
      fileName: 'firmware.rom',
      fileSize: 100000,
      header: bytes(16, () => 0x7f),
      includeMagic: true,
    });
    assert.deepStrictEqual(validateFormat(def).errors, []);
    assert.strictEqual(def.fileExtensions?.[0], '.rom');
    assert.ok(def.magic);
    const names = (def.fields ?? []).map((f) => f.name);
    assert.deepStrictEqual(names, ['magic', 'header', 'body']);
    // body is capped at 4096 so a huge file does not produce a huge field
    const body = def.fields!.find((f) => f.name === 'body')!;
    assert.strictEqual(body.size, 4096);
  });

  it('scaffoldWholeFile without magic still validates', () => {
    const def = scaffoldWholeFile({
      name: 'x',
      fileName: 'blob',
      fileSize: 40,
      header: new Uint8Array(0),
      includeMagic: false,
    });
    assert.deepStrictEqual(validateFormat(def).errors, []);
    assert.strictEqual(def.magic, undefined);
  });

  it('scaffoldArray (scalar) derives count from the scalar size', () => {
    const r = scaffoldArray({
      name: 'Draft',
      fileName: 'log.dat',
      start: 0x40,
      totalBytes: 4000,
      element: { kind: 'scalar', type: 'uint16' },
    });
    assert.deepStrictEqual(validateFormat(r.format).errors, []);
    assert.strictEqual(r.elementSize, 2);
    assert.strictEqual(r.count, 2000);
    const arr = r.format.fields![r.format.fields!.length - 1];
    assert.strictEqual(arr.type, 'array');
    assert.strictEqual(arr.offset, 0x40);
    assert.strictEqual(arr.count, 2000);
    assert.deepStrictEqual(arr.items, { name: 'value', type: 'uint16' });
  });

  it('scaffoldArray (bytes) uses the given record size and reports the remainder', () => {
    const r = scaffoldArray({
      name: 'x',
      fileName: 'recs.bin',
      start: 0,
      totalBytes: 1000,
      element: { kind: 'bytes', recordSize: 48 },
    });
    assert.strictEqual(r.elementSize, 48);
    assert.strictEqual(r.count, 20); // 20*48 = 960
    assert.strictEqual(r.remainder, 40);
    assert.deepStrictEqual(validateFormat(r.format).errors, []);
    const arr = r.format.fields![r.format.fields!.length - 1];
    assert.deepStrictEqual(arr.items, { name: 'entry', type: 'bytes', size: 48 });
  });

  it('scaffoldArray (struct) defines a reusable structure and references it', () => {
    const r = scaffoldArray({
      name: 'x',
      fileName: 'recs.bin',
      start: 0,
      totalBytes: 320,
      element: { kind: 'struct', recordSize: 32 },
    });
    assert.deepStrictEqual(validateFormat(r.format).errors, []);
    assert.strictEqual(r.count, 10);
    const arr = r.format.fields![r.format.fields!.length - 1];
    assert.deepStrictEqual(arr.items, { name: 'item', type: 'Record' });
    assert.ok(r.format.structures && r.format.structures.Record);
    const inner = r.format.structures!.Record.fields as { name: string }[];
    assert.deepStrictEqual(inner.map((f) => f.name), ['field0', 'rest']);
  });

  it('a generated array actually decodes the selected region', () => {
    // 4 records of 16 bytes at offset 8.
    const buf = new Uint8Array(8 + 64);
    for (let i = 0; i < 64; i++) {
      buf[8 + i] = i & 0xff;
    }
    const r = scaffoldArray({
      name: 'x',
      fileName: 'x.bin',
      start: 8,
      totalBytes: 64,
      element: { kind: 'bytes', recordSize: 16 },
    });
    const { nodes, error } = parseFormat(
      r.format,
      { baseOffset: 0, bytes: buf, fileSize: buf.length },
      { defaultEndianness: 'little' },
    );
    assert.strictEqual(error, undefined);
    const elems = nodes.filter((n: ParsedNode) => /^records\[\d+\]$/.test(n.name));
    assert.strictEqual(elems.length, 4);
    assert.deepStrictEqual(elems.map((n) => n.offset), [8, 24, 40, 56]);
    assert.strictEqual(elems.every((n) => n.size === 16), true);
  });

  it('scaffoldSingleField adds length for strings and size for bytes', () => {
    const asBytes = scaffoldSingleField({ name: 'x', fileName: 'x', start: 0x10, size: 12, type: 'bytes' });
    assert.deepStrictEqual(validateFormat(asBytes).errors, []);
    assert.strictEqual(asBytes.fields![0].size, 12);

    const asAscii = scaffoldSingleField({ name: 'x', fileName: 'x', start: 0, size: 8, type: 'ascii' });
    assert.strictEqual(asAscii.fields![0].length, 8);

    const asU32 = scaffoldSingleField({ name: 'x', fileName: 'x', start: 0, size: 4, type: 'uint32' });
    assert.strictEqual(asU32.fields![0].size, undefined);
  });
});
