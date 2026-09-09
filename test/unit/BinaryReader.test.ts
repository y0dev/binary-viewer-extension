import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BinaryReader } from '../../src/binary/BinaryReader';
import { BinaryCache } from '../../src/binary/BinaryCache';
import { searchBinary } from '../../src/binary/BinarySearch';

/** Minimal stand-in for a `file:` vscode.Uri. */
function fileUri(p: string): any {
  return { scheme: 'file', fsPath: p, toString: () => `file://${p}` };
}

let tmp: string;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'binview-test-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeFixture(name: string, buf: Buffer): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, buf);
  return p;
}

describe('BinaryReader', () => {
  it('performs positioned range reads and clamps at EOF', async () => {
    const buf = Buffer.alloc(1000);
    for (let i = 0; i < buf.length; i++) {
      buf[i] = i & 0xff;
    }
    const reader = await BinaryReader.create(fileUri(writeFixture('r.bin', buf)));
    try {
      assert.strictEqual(reader.size, 1000);
      const a = await reader.read(10, 4);
      assert.deepStrictEqual([...a], [10, 11, 12, 13]);
      const tail = await reader.read(998, 100); // past EOF
      assert.strictEqual(tail.length, 2);
      assert.deepStrictEqual([...tail], [998 & 0xff, 999 & 0xff]);
      const empty = await reader.read(5000, 10);
      assert.strictEqual(empty.length, 0);
    } finally {
      await reader.dispose();
    }
  });
});

describe('BinaryCache', () => {
  it('assembles ranges across block boundaries and stays bounded', async () => {
    const size = 1 << 20; // 1 MiB
    const buf = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
      buf[i] = (i * 7) & 0xff;
    }
    const reader = await BinaryReader.create(fileUri(writeFixture('c.bin', buf)));
    // 4 KiB blocks, cap ~64 KiB -> at most ~16 resident blocks.
    const cache = new BinaryCache(reader, 4096, 64 * 1024);
    try {
      // sweep the whole file in 3000-byte windows (straddling block edges)
      for (let off = 0; off + 3000 <= size; off += 2500) {
        const got = await cache.getRange(off, 3000);
        assert.strictEqual(got.length, 3000);
        assert.strictEqual(got[0], buf[off]);
        assert.strictEqual(got[2999], buf[off + 2999]);
      }
      assert.ok(
        cache.residentBlocks <= 20,
        `expected bounded cache, got ${cache.residentBlocks} blocks`,
      );
    } finally {
      await reader.dispose();
    }
  });
});

describe('searchBinary (streaming)', () => {
  it('finds next / previous / all without loading the whole file', async () => {
    const size = 3 * 1024 * 1024;
    const buf = Buffer.alloc(size, 0);
    const needle = Buffer.from('NEEDLE');
    const positions = [100, 1_500_000, size - 6];
    for (const p of positions) {
      needle.copy(buf, p);
    }
    const reader = await BinaryReader.create(fileUri(writeFixture('s.bin', buf)));
    try {
      const next = await searchBinary(
        reader,
        { kind: 'ascii', text: 'NEEDLE', from: 0, direction: 'next' },
        { maxResults: 100 },
      );
      assert.strictEqual(next.matches[0].offset, 100);

      const next2 = await searchBinary(
        reader,
        { kind: 'ascii', text: 'NEEDLE', from: 101, direction: 'next' },
        { maxResults: 100 },
      );
      assert.strictEqual(next2.matches[0].offset, 1_500_000);

      const prev = await searchBinary(
        reader,
        { kind: 'ascii', text: 'NEEDLE', from: size - 6, direction: 'previous' },
        { maxResults: 100 },
      );
      assert.strictEqual(prev.matches[0].offset, 1_500_000);

      const all = await searchBinary(
        reader,
        { kind: 'ascii', text: 'NEEDLE', from: 0, direction: 'all' },
        { maxResults: 100 },
      );
      assert.deepStrictEqual(all.matches.map((m) => m.offset), positions);
      assert.ok(all.done);
    } finally {
      await reader.dispose();
    }
  });

  it('finds matches that straddle the 1 MiB scan-chunk boundary', async () => {
    const size = 2 * 1024 * 1024;
    const buf = Buffer.alloc(size, 0);
    const boundary = 1024 * 1024;
    Buffer.from('CROSSING').copy(buf, boundary - 3); // straddles the chunk edge
    const reader = await BinaryReader.create(fileUri(writeFixture('x.bin', buf)));
    try {
      const res = await searchBinary(
        reader,
        { kind: 'ascii', text: 'CROSSING', from: 0, direction: 'all' },
        { maxResults: 10 },
      );
      assert.deepStrictEqual(res.matches.map((m) => m.offset), [boundary - 3]);
    } finally {
      await reader.dispose();
    }
  });
});
