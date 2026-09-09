import * as assert from 'assert';
import { parseFormat, ByteWindow } from '../../src/core/BinaryParser';
import type { FormatDefinition } from '../../src/types/format';

function win(bytes: number[], fileSize = bytes.length): ByteWindow {
  return { baseOffset: 0, bytes: Uint8Array.from(bytes), fileSize };
}

const EXAMPLE_BYTES = [
  0x01, 0x00, 0x00, 0x00, // uint32 = 1
  0x00, 0x04, // uint16 = 1024
  0x04, // uint8 = 4
  0x05, // flags = 0b0000_0101
  0x00, 0x00, 0x48, 0x41, // float32 = 12.5
  0x54, 0x45, 0x53, 0x54, // "TEST"
];

describe('BinaryParser', () => {
  it('parses the documented example structure with explicit offsets', () => {
    const fmt: FormatDefinition = {
      name: 'example',
      endianness: 'little',
      fields: [
        { name: 'a', type: 'uint32', offset: 0, display: 'hex' },
        { name: 'b', type: 'uint16', offset: 4 },
        { name: 'c', type: 'uint8', offset: 6, display: 'hex' },
        {
          name: 'd',
          type: 'flags',
          offset: 7,
          size: 1,
          fields: [
            { name: 'Enabled', bits: '0' },
            { name: 'Mode', bits: '1-3' },
          ],
        },
        { name: 'e', type: 'float', offset: 8 },
        { name: 'f', type: 'char', offset: 12, length: 4 },
      ],
    };
    const { nodes, error } = parseFormat(fmt, win(EXAMPLE_BYTES), { defaultEndianness: 'little' });
    assert.strictEqual(error, undefined);
    const byName = Object.fromEntries(nodes.filter((n) => n.depth === 0).map((n) => [n.name, n]));

    assert.strictEqual(byName.a.value, '0x00000001');
    assert.strictEqual(byName.a.offset, 0);
    assert.strictEqual(byName.a.size, 4);

    assert.strictEqual(byName.b.value, '1024');
    assert.strictEqual(byName.c.value, '0x04');

    assert.ok(byName.d.bits && byName.d.bits.length === 2);
    assert.strictEqual(byName.d.bits![0].value, 'true'); // Enabled
    assert.strictEqual(byName.d.bits![1].value, '2'); // Mode

    assert.strictEqual(byName.e.value, '12.5');
    assert.strictEqual(byName.f.value, '"TEST"');
    assert.strictEqual(byName.f.offset, 12);
  });

  it('reads correctly from a window backed by a subarray with a non-zero byteOffset', () => {
    const backing = Uint8Array.from([0xde, 0xad, ...EXAMPLE_BYTES, 0xbe, 0xef]);
    const view = backing.subarray(2, 2 + EXAMPLE_BYTES.length); // byteOffset = 2
    assert.strictEqual(view.byteOffset, 2);
    const fmt: FormatDefinition = {
      name: 'sub',
      fields: [
        { name: 'a', type: 'uint32', offset: 0 },
        { name: 'b', type: 'uint16', offset: 4 },
      ],
    };
    const { nodes } = parseFormat(
      fmt,
      { baseOffset: 0, bytes: view, fileSize: view.length },
      { defaultEndianness: 'little' },
    );
    assert.strictEqual(nodes[0].value, '1');
    assert.strictEqual(nodes[1].value, '1024');
  });

  it('lays out packed (offset-less) fields sequentially', () => {
    const fmt: FormatDefinition = {
      name: 'packed',
      fields: [
        { name: 'a', type: 'uint32' },
        { name: 'b', type: 'uint16' },
        { name: 'c', type: 'uint8' },
        { name: 'd', type: 'uint8' },
      ],
    };
    const { nodes } = parseFormat(fmt, win(EXAMPLE_BYTES), { defaultEndianness: 'little' });
    assert.deepStrictEqual(
      nodes.map((n) => n.offset),
      [0, 4, 6, 7],
    );
  });

  it('honours a per-field endianness override', () => {
    const fmt: FormatDefinition = {
      name: 'endian',
      endianness: 'little',
      fields: [
        { name: 'le', type: 'uint32', offset: 0 },
        { name: 'be', type: 'uint32', offset: 0, endianness: 'big' },
      ],
    };
    const { nodes } = parseFormat(fmt, win([0x00, 0x00, 0x00, 0x01]), { defaultEndianness: 'little' });
    assert.strictEqual(nodes[0].value, '16777216'); // LE of 00 00 00 01
    assert.strictEqual(nodes[1].value, '1'); // BE of 00 00 00 01
  });

  it('applies enum overlays and array expansion', () => {
    const fmt: FormatDefinition = {
      name: 'enum+array',
      fields: [
        { name: 'kind', type: 'uint8', offset: 0, enum: { '1': 'ALPHA', '2': 'BETA' } },
        {
          name: 'samples',
          type: 'array',
          offset: 1,
          count: 3,
          items: { name: 's', type: 'uint16' },
        },
      ],
    };
    const bytes = [0x02, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00];
    const { nodes } = parseFormat(fmt, win(bytes), { defaultEndianness: 'little' });
    assert.match(nodes[0].value, /BETA/);
    const elems = nodes.filter((n) => n.depth === 1);
    assert.strictEqual(elems.length, 3);
    assert.deepStrictEqual(elems.map((n) => n.value), ['1', '2', '3']);
    assert.deepStrictEqual(elems.map((n) => n.offset), [1, 3, 5]);
  });

  it('parses nested structs with relative offsets', () => {
    const fmt: FormatDefinition = {
      name: 'nested',
      fields: [
        {
          name: 'header',
          type: 'struct',
          offset: 2,
          fields: [
            { name: 'x', type: 'uint8', offset: 0 },
            { name: 'y', type: 'uint8', offset: 1 },
          ],
        },
      ],
    };
    const { nodes } = parseFormat(fmt, win([0, 0, 0xaa, 0xbb]), { defaultEndianness: 'little' });
    const x = nodes.find((n) => n.name === 'x')!;
    const y = nodes.find((n) => n.name === 'y')!;
    assert.strictEqual(x.offset, 2);
    assert.strictEqual(x.value, '170');
    assert.strictEqual(y.offset, 3);
    assert.strictEqual(y.value, '187');
  });

  it('emits an error node when a field reads past the loaded window / EOF', () => {
    const fmt: FormatDefinition = {
      name: 'oob',
      fields: [{ name: 'big', type: 'uint32', offset: 6 }],
    };
    const { nodes } = parseFormat(fmt, win([0, 1, 2, 3, 4, 5, 6, 7], 8), { defaultEndianness: 'little' });
    assert.ok(nodes[0].error, 'expected an error on the node');
  });

  it('treats an integer scalar carrying bit specs as a bit-field (section 7 form)', () => {
    const fmt: FormatDefinition = {
      name: 'status',
      fields: [
        {
          name: 'Status',
          type: 'uint8',
          offset: 0,
          fields: [
            { name: 'Enabled', bits: '0' },
            { name: 'Mode', bits: '1-3' },
            { name: 'Error', bits: '4' },
            { name: 'Reserved', bits: '5-7' },
          ],
        },
      ],
    };
    const { nodes } = parseFormat(fmt, win([0x15]), { defaultEndianness: 'little' });
    assert.strictEqual(nodes[0].size, 1);
    assert.ok(nodes[0].bits);
    const byName = Object.fromEntries(nodes[0].bits!.map((b) => [b.name, b.value]));
    assert.strictEqual(byName.Enabled, 'true');
    assert.strictEqual(byName.Mode, '2');
    assert.strictEqual(byName.Error, 'true');
  });

  it('converts unix timestamps', () => {
    const fmt: FormatDefinition = {
      name: 'ts',
      fields: [
        {
          name: 'built',
          type: 'timestamp',
          offset: 0,
          timestamp: { size: 4, unit: 's', epoch: 'unix' },
        },
      ],
    };
    // 2021-01-01T00:00:00Z = 1609459200
    const secs = 1609459200;
    const bytes = [secs & 0xff, (secs >> 8) & 0xff, (secs >> 16) & 0xff, (secs >> 24) & 0xff];
    const { nodes } = parseFormat(fmt, win(bytes), { defaultEndianness: 'little' });
    assert.strictEqual(nodes[0].value, '2021-01-01T00:00:00.000Z');
  });
});
