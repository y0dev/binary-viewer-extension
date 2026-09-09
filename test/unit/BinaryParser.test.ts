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

describe('BinaryParser — array countField (length prefix)', () => {
  const fmt: FormatDefinition = {
    name: 'lp',
    endianness: 'little',
    fields: [
      { name: 'n', type: 'uint16', offset: 0 },
      {
        name: 'values',
        type: 'array',
        offset: 2,
        countField: 'n',
        items: { name: 'v', type: 'uint8' },
      },
      { name: 'trailer', type: 'uint8' },
    ],
  };

  it('takes the element count from the named earlier field', () => {
    const { nodes, error } = parseFormat(fmt, win([3, 0, 10, 11, 12, 0xff]), {
      defaultEndianness: 'little',
    });
    assert.strictEqual(error, undefined);
    const arr = nodes.find((n) => n.name === 'values')!;
    assert.strictEqual(arr.isContainer, true);
    assert.strictEqual(arr.value, '3 elements');
    const elems = nodes.filter((n) => /^values\[\d+\]$/.test(n.name)).map((n) => n.value);
    assert.deepStrictEqual(elems, ['10', '11', '12']);
    // The field packed after the dynamic array lands at the right offset.
    const trailer = nodes.find((n) => n.name === 'trailer')!;
    assert.strictEqual(trailer.offset, 5);
    assert.strictEqual(trailer.value, '255');
  });

  it('handles a zero-length prefix', () => {
    const { nodes } = parseFormat(fmt, win([0, 0, 0x2a]), { defaultEndianness: 'little' });
    assert.strictEqual(nodes.filter((n) => /^values\[\d+\]$/.test(n.name)).length, 0);
    assert.strictEqual(nodes.find((n) => n.name === 'trailer')!.offset, 2);
  });

  it('flags an unknown countField without throwing', () => {
    const bad: FormatDefinition = {
      name: 'bad',
      fields: [{ name: 'xs', type: 'array', offset: 0, countField: 'missing', items: { name: 'v', type: 'uint8' } }],
    };
    const { nodes, error } = parseFormat(bad, win([1, 2, 3]), { defaultEndianness: 'little' });
    assert.strictEqual(error, undefined);
    assert.match(nodes[0].error ?? '', /count field "missing" not found/);
  });

  it('an explicit count still wins over countField', () => {
    const both: FormatDefinition = {
      name: 'both',
      fields: [
        { name: 'n', type: 'uint8', offset: 0 },
        { name: 'xs', type: 'array', offset: 1, count: 2, countField: 'n', items: { name: 'v', type: 'uint8' } },
      ],
    };
    const { nodes } = parseFormat(both, win([9, 1, 2, 3, 4]), { defaultEndianness: 'little' });
    assert.strictEqual(nodes.filter((n) => /^xs\[\d+\]$/.test(n.name)).length, 2);
  });
});

describe('BinaryParser — nested-array element stride', () => {
  it('advances the parent offset by a fixed inner array size (3D)', () => {
    const fmt: FormatDefinition = {
      name: '3d',
      endianness: 'little',
      fields: [
        {
          name: 'vol',
          type: 'array',
          offset: 0,
          count: 2,
          items: {
            name: 'plane',
            type: 'array',
            count: 3,
            items: { name: 'row', type: 'array', count: 4, items: { name: 'c', type: 'int16' } },
          },
        },
      ],
    };
    const { nodes } = parseFormat(fmt, win(new Array(48).fill(0)), { defaultEndianness: 'little' });
    const planes = nodes.filter((n) => /^vol\[\d+\]$/.test(n.name));
    assert.deepStrictEqual(planes.map((n) => n.offset), [0, 24]);
    const rowsOf0 = nodes.filter((n) => /^vol\[0\]\[\d+\]$/.test(n.name));
    assert.deepStrictEqual(rowsOf0.map((n) => n.offset), [0, 8, 16]);
  });

  it('advances by a runtime (countField) inner array size', () => {
    const fmt: FormatDefinition = {
      name: 'dyn',
      endianness: 'little',
      fields: [
        { name: 'rows', type: 'uint8', offset: 0 },
        {
          name: 'grid',
          type: 'array',
          offset: 1,
          count: 2,
          items: { name: 'plane', type: 'array', countField: 'rows', items: { name: 'c', type: 'uint8' } },
        },
        { name: 'tail', type: 'uint8' },
      ],
    };
    const { nodes } = parseFormat(fmt, win([3, 10, 11, 12, 20, 21, 22, 0xee]), {
      defaultEndianness: 'little',
    });
    const planes = nodes.filter((n) => /^grid\[\d+\]$/.test(n.name));
    assert.deepStrictEqual(planes.map((n) => n.offset), [1, 4]);
    assert.deepStrictEqual(
      nodes.filter((n) => /^grid\[1\]\[\d+\]$/.test(n.name)).map((n) => n.value),
      ['20', '21', '22'],
    );
    assert.strictEqual(nodes.find((n) => n.name === 'tail')!.offset, 7);
  });

  it('grows a struct size when a countField child consumes more than its static size', () => {
    const fmt: FormatDefinition = {
      name: 'aos',
      endianness: 'little',
      fields: [
        {
          name: 'recs',
          type: 'array',
          offset: 0,
          count: 2,
          items: {
            name: 'rec',
            fields: [
              { name: 'n', type: 'uint8', offset: 0 },
              { name: 'vals', type: 'array', offset: 1, countField: 'n', items: { name: 'x', type: 'uint8' } },
            ],
          },
        },
      ],
    };
    const { nodes } = parseFormat(fmt, win([2, 10, 20, 3, 30, 40, 50, 0xee]), {
      defaultEndianness: 'little',
    });
    const recs = nodes.filter((n) => /^recs\[\d+\]$/.test(n.name));
    assert.deepStrictEqual(recs.map((n) => n.offset), [0, 3]);
    assert.deepStrictEqual(recs.map((n) => n.size), [3, 4]);
  });
});
