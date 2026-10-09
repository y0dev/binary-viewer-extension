import * as assert from 'assert';
import { searchBinary, streamSearch, SearchOutcome } from '../../src/binary/BinarySearch';
import { BinaryReader } from '../../src/binary/BinaryReader';
import type { SearchQuery } from '../../src/types/messages';

function reader(bytes: Uint8Array): BinaryReader {
  return { size: bytes.length, read: async (offset: number, length: number) => bytes.subarray(offset, offset + length) } as BinaryReader;
}
const query: SearchQuery = { kind: 'ascii', text: 'AB', from: 0, direction: 'all' };
const CHUNK = 1 << 20;

describe('BinarySearch', () => {
  it('finds a backward match starting before the cursor and ending after it', async () => {
    const result = await searchBinary(reader(Buffer.from('XXABAB')), { ...query, direction: 'previous', from: 5 }, { maxResults: 10 });
    assert.deepStrictEqual(result.matches, [{ offset: 4, length: 2 }]);
  });

  it('excludes a backward match starting exactly at the cursor', async () => {
    const result = await searchBinary(reader(Buffer.from('XXABAB')), { ...query, direction: 'previous', from: 4 }, { maxResults: 10 });
    assert.deepStrictEqual(result.matches, [{ offset: 2, length: 2 }]);
  });

  it('finds backward matches crossing a scan chunk boundary', async () => {
    const bytes = Buffer.alloc(CHUNK + 20);
    bytes.write('AB', 19);
    const result = await searchBinary(reader(bytes), { ...query, direction: 'previous', from: bytes.length }, { maxResults: 10 });
    assert.deepStrictEqual(result.matches, [{ offset: 19, length: 2 }]);
  });

  it('resumes forward scans without losing or duplicating boundary matches', async () => {
    const bytes = Buffer.alloc(CHUNK * 2 + 20);
    for (const at of [CHUNK - 1, CHUNK + 5, CHUNK * 2 + 2]) { bytes.write('AB', at); }
    const file = reader(bytes);
    let from = 0;
    const offsets: number[] = [];
    for (let slice = 0; slice < 4; slice++) {
      const result = await searchBinary(file, { ...query, from }, { maxResults: 10, timeBudgetMs: -1 });
      offsets.push(...result.matches.map((m) => m.offset));
      if (result.done) { break; }
      assert.ok(result.scannedTo > from);
      from = result.scannedTo;
    }
    assert.deepStrictEqual(offsets, [CHUNK - 1, CHUNK + 5, CHUNK * 2 + 2]);
  });

  it('resumes backward scans at the unscanned boundary', async () => {
    const bytes = Buffer.alloc(CHUNK * 2 + 20);
    bytes.write('AB', 10);
    const file = reader(bytes);
    const first = await searchBinary(file, { ...query, direction: 'previous', from: bytes.length }, { maxResults: 10, timeBudgetMs: -1 });
    assert.strictEqual(first.done, false);
    const next = await searchBinary(file, { ...query, direction: 'previous', from: first.scannedTo }, { maxResults: 10 });
    assert.deepStrictEqual(next.matches, [{ offset: 10, length: 2 }]);
  });

  it('reports an uncapped full scan as complete with an EOF continuation offset', async () => {
    for (const text of ['ABXXAB', 'XXXX', '']) {
      const result = await searchBinary(reader(Buffer.from(text)), query, { maxResults: 10 });
      assert.strictEqual(result.done, true);
      assert.strictEqual(result.scannedTo, text.length);
      assert.ok(!result.truncated);
    }
  });

  it('reports capped results as incomplete', async () => {
    const result = await searchBinary(reader(Buffer.from('ABABAB')), query, { maxResults: 2 });
    assert.strictEqual(result.truncated, true);
    assert.deepStrictEqual(result.matches.map((m) => m.offset), [0, 2]);
    assert.strictEqual(result.scannedTo, 3);
  });

  it('does not let overlap-only hits consume the next-match limit', async () => {
    const bytes = Buffer.alloc(CHUNK + 10);
    bytes.write('AB', CHUNK);
    const result = await searchBinary(reader(bytes), { ...query, direction: 'next' }, { maxResults: 10 });
    assert.deepStrictEqual(result.matches, [{ offset: CHUNK, length: 2 }]);
  });

  it('automatically continues all-result scans and caps matches across batches', async () => {
    const bytes = Buffer.alloc(CHUNK * 2 + 20);
    bytes.write('AB', 0);
    bytes.write('AB', CHUNK + 2);
    bytes.write('AB', CHUNK * 2 + 2);
    const batches: SearchOutcome[] = [];
    await streamSearch(reader(bytes), query, { maxResults: 2, timeBudgetMs: -1 }, (batch) => batches.push(batch));
    assert.strictEqual(batches.length, 2);
    assert.strictEqual(batches[0].done, false);
    assert.strictEqual(batches[1].done, true);
    assert.strictEqual(batches[1].truncated, true);
    assert.deepStrictEqual(batches.flatMap((b) => b.matches.map((m) => m.offset)), [0, CHUNK + 2]);
  });

  it('continues next and previous scans until a distant match is found', async () => {
    const bytes = Buffer.alloc(CHUNK * 3);
    for (const direction of ['next', 'previous'] as const) {
      bytes.fill(0);
      const offset = direction === 'next' ? CHUNK * 2 : 10;
      bytes.write('AB', offset);
      const batches: SearchOutcome[] = [];
      await streamSearch(reader(bytes), {
        ...query, direction, from: direction === 'next' ? 0 : bytes.length,
      }, { maxResults: 10, timeBudgetMs: -1 }, (batch) => batches.push(batch));
      assert.ok(batches.length > 1);
      assert.strictEqual(batches[batches.length - 1].done, true);
      assert.deepStrictEqual(batches.flatMap((b) => b.matches.map((m) => m.offset)), [offset]);
    }
  });

  it('stops continuation after cancellation without sending more batches', async () => {
    const controller = new AbortController();
    const bytes = Buffer.alloc(CHUNK * 3);
    let batches = 0;
    await assert.rejects(streamSearch(reader(bytes), query, {
      maxResults: 10, timeBudgetMs: -1, signal: controller.signal,
    }, () => { batches++; controller.abort(); }), { name: 'AbortError' });
    assert.strictEqual(batches, 1);
  });

  it('honors cancellation before and after a file read', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(searchBinary(reader(Buffer.from('AB')), query, { maxResults: 10, signal: controller.signal }), { name: 'AbortError' });
    const duringRead = new AbortController();
    const file = { size: 2, read: async () => { duringRead.abort(); return Buffer.from('AB'); } } as unknown as BinaryReader;
    await assert.rejects(searchBinary(file, query, { maxResults: 10, signal: duringRead.signal }), { name: 'AbortError' });
  });
});
