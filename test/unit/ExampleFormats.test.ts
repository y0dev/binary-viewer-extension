import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { validateFormat } from '../../src/core/FormatSchema';
import { parseFormat } from '../../src/core/BinaryParser';
import { detectFormats } from '../../src/core/FormatDetector';
import type { FormatDefinition } from '../../src/types/format';
import type { ParsedNode } from '../../src/types/messages';

const REPO = path.resolve(__dirname, '../../..');
const FORMATS_DIR = path.join(REPO, 'examples', 'formats');
const BIN_DIR = path.join(REPO, 'examples', 'binaries');

function loadFormat(name: string): FormatDefinition {
  return JSON.parse(fs.readFileSync(path.join(FORMATS_DIR, name), 'utf8'));
}
function loadBin(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(BIN_DIR, name)));
}
function byName(nodes: ParsedNode[]): Record<string, ParsedNode> {
  const out: Record<string, ParsedNode> = {};
  for (const n of nodes) {
    if (!(n.name in out)) {
      out[n.name] = n;
    }
  }
  return out;
}

describe('Shipped example formats', () => {
  it('every examples/formats/*.json is a valid definition', () => {
    const files = fs.readdirSync(FORMATS_DIR).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 5, 'expected several example formats');
    for (const f of files) {
      const r = validateFormat(loadFormat(f));
      assert.deepStrictEqual(r.errors, [], `${f}: ${r.errors.join('; ')}`);
    }
  });

  it('WAV / RIFF Header decodes sample.wav with correct nested offsets', () => {
    const def = loadFormat('wav-header.json');
    const bytes = loadBin('sample.wav');

    assert.strictEqual(
      detectFormats([def], 'sample.wav', bytes)[0]?.format.name,
      'WAV / RIFF Header',
    );

    const { nodes, error } = parseFormat(
      def,
      { baseOffset: 0, bytes, fileSize: bytes.length },
      { defaultEndianness: 'little' },
    );
    assert.strictEqual(error, undefined);
    const n = byName(nodes);

    assert.strictEqual(n['ChunkID'].value, '"RIFF"');
    assert.strictEqual(n['Format'].value, '"WAVE"');
    assert.strictEqual(n['fmt chunk'].isContainer, true);
    assert.strictEqual(n['fmt chunk'].offset, 12);
    assert.match(n['AudioFormat'].value, /PCM/);
    assert.strictEqual(n['AudioFormat'].offset, 20); // 12 (chunk) + 8 (relative)
    assert.strictEqual(n['SampleRate'].offset, 24);
    assert.strictEqual(n['SampleRate'].value, '44100 Hz');
    assert.strictEqual(n['data chunk'].offset, 36);
    assert.deepStrictEqual(n['SampleRate'].path, ['fmt chunk', 'SampleRate']);
  });

  it('MBR Partition Table decodes disk.mbr (array of nested structs + magic at 510)', () => {
    const def = loadFormat('mbr.json');
    const bytes = loadBin('disk.mbr');

    // magic lives at offset 510, not 0
    assert.strictEqual(
      detectFormats([def], 'disk.mbr', bytes)[0]?.format.name,
      'MBR Partition Table',
    );

    const { nodes, error } = parseFormat(
      def,
      { baseOffset: 0, bytes, fileSize: bytes.length },
      { defaultEndianness: 'little' },
    );
    assert.strictEqual(error, undefined);

    const partitions = nodes.filter((x) => x.name.startsWith('Partitions['));
    assert.strictEqual(partitions.length, 4);
    assert.strictEqual(partitions[0].offset, 446);
    assert.strictEqual(partitions[1].offset, 462);
    assert.strictEqual(partitions[0].isContainer, true);

    const p0Type = nodes.find(
      (x) => x.name === 'Type' && x.parentId === partitions[0].id,
    )!;
    assert.match(p0Type.value, /FAT32 \(LBA\)/);
    assert.strictEqual(p0Type.offset, 446 + 4);

    const p0Lba = nodes.find(
      (x) => x.name === 'LBA First' && x.parentId === partitions[0].id,
    )!;
    assert.strictEqual(p0Lba.value, '2048 sectors');

    const sig = nodes.find((x) => x.name === 'Signature')!;
    assert.strictEqual(sig.offset, 510);
    assert.strictEqual(sig.value, '0xAA55');
  });
});
