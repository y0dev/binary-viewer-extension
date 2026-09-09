import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BinaryReader } from '../../src/binary/BinaryReader';
import { BinaryCache } from '../../src/binary/BinaryCache';

function fileUri(p: string): any {
  return { scheme: 'file', fsPath: p, toString: () => `file://${p}` };
}

let tmp: string;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'binview-large-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SIZES: [string, number][] = [
  ['1MB', 1 * 1024 * 1024],
  ['10MB', 10 * 1024 * 1024],
  ['100MB', 100 * 1024 * 1024],
];

for (const [label, size] of SIZES) {
  it(`opens a ${label} file and reads scattered ranges with a bounded cache`, async function () {
    this.timeout(60000);
    const p = path.join(tmp, `${label}.bin`);
    // Write it in streaming chunks so the test itself never holds the whole file.
    const fd = fs.openSync(p, 'w');
    const CHUNK = 1 << 20;
    const chunk = Buffer.allocUnsafe(CHUNK);
    for (let written = 0; written < size; written += CHUNK) {
      const n = Math.min(CHUNK, size - written);
      for (let i = 0; i < n; i++) {
        chunk[i] = (written + i) & 0xff;
      }
      fs.writeSync(fd, chunk, 0, n);
    }
    fs.closeSync(fd);

    const reader = await BinaryReader.create(fileUri(p));
    const cache = new BinaryCache(reader, 65536, 4 * 1024 * 1024);
    try {
      assert.strictEqual(reader.size, size);
      const probes = [0, 1234, size >> 1, size - 512, size - 16];
      for (const off of probes) {
        const len = Math.min(512, size - off);
        const bytes = await cache.getRange(off, len);
        assert.strictEqual(bytes.length, len);
        assert.strictEqual(bytes[0], off & 0xff);
        assert.strictEqual(bytes[len - 1], (off + len - 1) & 0xff);
      }
      // Cache must not have ballooned to the file size.
      assert.ok(
        cache.residentBlocks * 65536 <= 4 * 1024 * 1024 + 65536,
        `cache grew to ${cache.residentBlocks} blocks`,
      );
    } finally {
      await reader.dispose();
    }
  });
}

it('opens a 1 GB sparse file and reads a range near the end', async function () {
  this.timeout(60000);
  const size = 1024 * 1024 * 1024;
  const p = path.join(tmp, '1gb-sparse.bin');
  const fd = fs.openSync(p, 'w');
  try {
    fs.ftruncateSync(fd, size);
    const marker = Buffer.from('BINVIEW-EOF');
    fs.writeSync(fd, marker, 0, marker.length, size - marker.length);
  } catch (e) {
    fs.closeSync(fd);
    this.skip(); // filesystem does not support sparse files / large truncate
    return;
  }
  fs.closeSync(fd);

  const reader = await BinaryReader.create(fileUri(p));
  const cache = new BinaryCache(reader, 65536, 2 * 1024 * 1024);
  try {
    assert.strictEqual(reader.size, size);
    const near = await cache.getRange(size - 11, 11);
    assert.strictEqual(Buffer.from(near).toString('ascii'), 'BINVIEW-EOF');
    const mid = await cache.getRange(500_000_000, 32);
    assert.strictEqual(mid.length, 32);
    assert.ok(cache.residentBlocks * 65536 <= 2 * 1024 * 1024 + 65536);
  } finally {
    await reader.dispose();
  }
});
