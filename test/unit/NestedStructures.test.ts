import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseFormat, ByteWindow } from '../../src/core/BinaryParser';
import { computeFieldSize, computeStructSize } from '../../src/core/BinaryField';
import { validateFormat } from '../../src/core/FormatSchema';
import { detectFormats } from '../../src/core/FormatDetector';
import type { FormatDefinition, FieldDefinition } from '../../src/types/format';
import type { ParsedNode } from '../../src/types/messages';

// out/test/unit/<file>.js  ->  repo root
const REPO = path.resolve(__dirname, '../../..');

function win(len: number, fill?: (buf: Uint8Array) => void): ByteWindow {
  const bytes = new Uint8Array(len);
  fill?.(bytes);
  return { baseOffset: 0, bytes, fileSize: len };
}

function nodesByName(nodes: ParsedNode[]): Record<string, ParsedNode> {
  const out: Record<string, ParsedNode> = {};
  for (const n of nodes) {
    out[n.name] = n;
  }
  return out;
}

describe('Nested structures — parser', () => {
  it('keeps flat primitive fields working exactly as before (backward compatible)', () => {
    const fmt: FormatDefinition = {
      name: 'flat',
      fields: [
        { name: 'Magic', type: 'uint32', offset: 0 },
        { name: 'Version', type: 'uint16', offset: 4 },
      ],
    };
    const { nodes, error } = parseFormat(fmt, win(8), { defaultEndianness: 'little' });
    assert.strictEqual(error, undefined);
    assert.strictEqual(nodes.length, 2);
    assert.strictEqual(nodes[0].depth, 0);
    assert.strictEqual(nodes[0].parentId, null);
    assert.strictEqual(nodes[0].isContainer, undefined);
    assert.deepStrictEqual(nodes[1].path, ['Version']);
  });

  it('treats a typeless field with `fields` as a container (Option 2)', () => {
    const fmt: FormatDefinition = {
      name: 'opt2',
      fields: [
        {
          name: 'Header',
          offset: 0,
          fields: [
            { name: 'Magic', type: 'uint32' },
            { name: 'Version', type: 'uint16' },
            { name: 'Flags', type: 'uint16' },
          ],
        },
      ],
    };
    const { nodes } = parseFormat(fmt, win(8), { defaultEndianness: 'little' });
    const byName = nodesByName(nodes);
    assert.strictEqual(byName.Header.isContainer, true);
    assert.strictEqual(byName.Header.offset, 0);
    assert.strictEqual(byName.Header.size, 8);

    // Children packed sequentially, offsets relative to Header (which is at 0).
    assert.strictEqual(byName.Magic.offset, 0);
    assert.strictEqual(byName.Version.offset, 4);
    assert.strictEqual(byName.Flags.offset, 6);
    assert.strictEqual(byName.Magic.parentId, byName.Header.id);
    assert.deepStrictEqual(byName.Flags.path, ['Header', 'Flags']);
    assert.strictEqual(byName.Magic.depth, 1);
  });

  it('adds parent offset to child offsets (relative -> absolute)', () => {
    const fmt: FormatDefinition = {
      name: 'rel',
      fields: [
        {
          name: 'Header',
          offset: 0x20,
          fields: [
            { name: 'Version', type: 'uint16', offset: 0 },
            { name: 'Flags', type: 'uint16', offset: 2 },
          ],
        },
      ],
    };
    const { nodes } = parseFormat(fmt, win(0x30), { defaultEndianness: 'little' });
    const byName = nodesByName(nodes);
    assert.strictEqual(byName.Header.offset, 0x20);
    assert.strictEqual(byName.Version.offset, 0x20);
    assert.strictEqual(byName.Flags.offset, 0x22);
  });

  it('recurses arbitrarily deep (structure inside structure inside structure)', () => {
    const fmt: FormatDefinition = {
      name: 'deep',
      fields: [
        {
          name: 'Firmware',
          offset: 0,
          fields: [
            {
              name: 'Header',
              offset: 0,
              fields: [
                {
                  name: 'Identification',
                  offset: 0,
                  fields: [
                    { name: 'Magic', type: 'uint32', offset: 0 },
                    { name: 'Version', type: 'uint16', offset: 4 },
                  ],
                },
                {
                  name: 'ImageInfo',
                  offset: 8,
                  fields: [
                    { name: 'ImageSize', type: 'uint32', offset: 0 },
                    { name: 'LoadAddress', type: 'uint32', offset: 4 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { nodes } = parseFormat(fmt, win(64), { defaultEndianness: 'little' });
    const byName = nodesByName(nodes);
    assert.strictEqual(byName.Magic.depth, 3);
    assert.strictEqual(byName.Magic.offset, 0);
    assert.strictEqual(byName.Version.offset, 4);
    assert.strictEqual(byName.ImageSize.offset, 8);
    assert.strictEqual(byName.LoadAddress.offset, 12);
    assert.deepStrictEqual(byName.LoadAddress.path, [
      'Firmware',
      'Header',
      'ImageInfo',
      'LoadAddress',
    ]);
    // Sizes bubble up.
    assert.strictEqual(byName.Identification.size, 6);
    assert.strictEqual(byName.ImageInfo.size, 8);
    assert.strictEqual(byName.Header.size, 16);
    assert.strictEqual(byName.Firmware.size, 16);
  });

  it('uses an explicit structure size when given, else computes from fields', () => {
    const explicit: FieldDefinition = {
      name: 'Header',
      offset: 0,
      size: 32,
      fields: [
        { name: 'Magic', type: 'uint32', offset: 0 },
        { name: 'Version', type: 'uint16', offset: 4 },
      ],
    };
    assert.strictEqual(computeStructSize(explicit), 32);
    assert.strictEqual(computeFieldSize(explicit), 32);

    const auto: FieldDefinition = {
      name: 'Header',
      offset: 0,
      fields: [
        { name: 'A', type: 'uint32', offset: 0 },
        { name: 'B', type: 'uint32', offset: 8 }, // ends at 12
      ],
    };
    assert.strictEqual(computeStructSize(auto), 12);
  });

  it('handles a mix of fields and structures at the same level', () => {
    const fmt: FormatDefinition = {
      name: 'mixed',
      fields: [
        { name: 'FileMagic', type: 'uint32', offset: 0 },
        {
          name: 'Header',
          offset: 4,
          fields: [
            { name: 'Version', type: 'uint16', offset: 0 },
            { name: 'Flags', type: 'uint16', offset: 2 },
          ],
        },
        { name: 'Checksum', type: 'uint32', offset: 20 },
      ],
    };
    const { nodes } = parseFormat(fmt, win(32), { defaultEndianness: 'little' });
    const byName = nodesByName(nodes);
    assert.strictEqual(byName.FileMagic.depth, 0);
    assert.strictEqual(byName.Header.depth, 0);
    assert.strictEqual(byName.Version.depth, 1);
    assert.strictEqual(byName.Version.offset, 4);
    assert.strictEqual(byName.Flags.offset, 6);
    assert.strictEqual(byName.Checksum.depth, 0);
    assert.strictEqual(byName.Checksum.offset, 20);
  });

  it('supports the section-15 example format and its exact offsets', () => {
    const fmt: FormatDefinition = {
      name: 'Example Firmware',
      fileExtensions: ['.fw'],
      endianness: 'little',
      fields: [
        {
          name: 'Header',
          offset: 0,
          fields: [
            { name: 'Magic', type: 'uint32', offset: 0, description: 'Firmware magic value' },
            { name: 'Version', type: 'uint16', offset: 4 },
            { name: 'Flags', type: 'uint16', offset: 6 },
          ],
        },
        {
          name: 'ImageInfo',
          offset: 8,
          fields: [
            { name: 'ImageSize', type: 'uint32', offset: 0 },
            { name: 'LoadAddress', type: 'uint32', offset: 4 },
            { name: 'EntryPoint', type: 'uint32', offset: 8 },
          ],
        },
        { name: 'Checksum', type: 'uint32', offset: 20 },
      ],
    };
    const { nodes, error } = parseFormat(fmt, win(24), { defaultEndianness: 'little' });
    assert.strictEqual(error, undefined);
    const byName = nodesByName(nodes);
    assert.strictEqual(byName.Magic.offset, 0x00);
    assert.strictEqual(byName.Version.offset, 0x04);
    assert.strictEqual(byName.Flags.offset, 0x06);
    assert.strictEqual(byName.ImageInfo.offset, 0x08);
    assert.strictEqual(byName.ImageSize.offset, 0x08);
    assert.strictEqual(byName.LoadAddress.offset, 0x0c);
    assert.strictEqual(byName.EntryPoint.offset, 0x10);
    assert.strictEqual(byName.Checksum.offset, 0x14);
  });

  it('reads values from the correct absolute bytes for a deeply nested field', () => {
    // LoadAddress lives at absolute 0x0C; write 0xAABBCCDD there (LE).
    const fmt: FormatDefinition = {
      name: 'read',
      fields: [
        {
          name: 'ImageInfo',
          offset: 8,
          fields: [
            { name: 'ImageSize', type: 'uint32', offset: 0 },
            { name: 'LoadAddress', type: 'uint32', offset: 4, display: 'hex' },
          ],
        },
      ],
    };
    const { nodes } = parseFormat(
      fmt,
      win(32, (b) => {
        b[0x0c] = 0xdd;
        b[0x0d] = 0xcc;
        b[0x0e] = 0xbb;
        b[0x0f] = 0xaa;
      }),
      { defaultEndianness: 'little' },
    );
    const byName = nodesByName(nodes);
    assert.strictEqual(byName.LoadAddress.offset, 0x0c);
    assert.strictEqual(byName.LoadAddress.value, '0xAABBCCDD');
  });

  it('raw-sync: a nested container reports its full absolute byte range', () => {
    const fmt: FormatDefinition = {
      name: 'sync',
      fields: [
        {
          name: 'Header',
          offset: 0x100,
          size: 32,
          fields: [{ name: 'X', type: 'uint32', offset: 0 }],
        },
      ],
    };
    const { nodes } = parseFormat(fmt, win(0x200), { defaultEndianness: 'little' });
    const header = nodes.find((n) => n.name === 'Header')!;
    assert.strictEqual(header.offset, 0x100);
    assert.strictEqual(header.size, 32); // selection would highlight 0x100..0x11F
    const x = nodes.find((n) => n.name === 'X')!;
    assert.strictEqual(x.offset, 0x100);
    assert.strictEqual(x.size, 4); // selecting X highlights only 0x100..0x103
  });

  it('loads and displays the shipped example nested format end-to-end', () => {
    const defPath = path.join(REPO, 'examples/formats/nested-firmware.json');
    const binPath = path.join(REPO, 'examples/binaries/nested.fw');
    const def = JSON.parse(fs.readFileSync(defPath, 'utf8')) as FormatDefinition;

    // 1. it validates
    const v = validateFormat(def);
    assert.deepStrictEqual(v.errors, [], v.errors.join('\n'));

    // 2. it is detected for the example binary by magic + extension
    const bytes = new Uint8Array(fs.readFileSync(binPath));
    const hits = detectFormats([def], 'nested.fw', bytes);
    assert.strictEqual(hits[0]?.format.name, 'Example Firmware (nested)');

    // 3. it parses into the expected tree with correct absolute offsets
    const { nodes, error } = parseFormat(
      def,
      { baseOffset: 0, bytes, fileSize: bytes.length },
      { defaultEndianness: 'little' },
    );
    assert.strictEqual(error, undefined);
    const byName = nodesByName(nodes);

    assert.strictEqual(byName.Header.isContainer, true);
    assert.strictEqual(byName.Header.depth, 0);
    assert.strictEqual(byName.Magic.depth, 1);
    assert.strictEqual(byName.Magic.offset, 0x00);
    assert.strictEqual(byName.Magic.value, '0x00015746');
    assert.strictEqual(byName.ImageInfo.offset, 0x08);
    assert.strictEqual(byName.LoadAddress.offset, 0x0c);
    assert.strictEqual(byName.LoadAddress.value, '0x08000000');
    assert.strictEqual(byName.EntryPoint.offset, 0x10);
    assert.strictEqual(byName.Checksum.offset, 0x14);
    assert.strictEqual(byName.Checksum.value, '0xDEADBEEF');

    // nested bit-field inside the nested Header
    assert.ok(byName.Flags.bits && byName.Flags.bits.length >= 3);
    assert.deepStrictEqual(byName.Flags.path, ['Header', 'Flags']);
  });

  it('accepts the legacy explicit `type: "struct"` form', () => {
    const fmt: FormatDefinition = {
      name: 'legacy',
      fields: [
        {
          name: 'Header',
          type: 'struct',
          offset: 2,
          fields: [
            { name: 'x', type: 'uint8', offset: 0 },
            { name: 'y', type: 'uint8', offset: 1 },
          ],
        },
      ],
    };
    const { nodes } = parseFormat(
      fmt,
      win(8, (b) => {
        b[2] = 0xaa;
        b[3] = 0xbb;
      }),
      { defaultEndianness: 'little' },
    );
    const byName = nodesByName(nodes);
    assert.strictEqual(byName.Header.isContainer, true);
    assert.strictEqual(byName.x.offset, 2);
    assert.strictEqual(byName.x.value, '170');
    assert.strictEqual(byName.y.offset, 3);
  });
});
