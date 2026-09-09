import { BinaryReader } from './BinaryReader';

/**
 * A small, bounded, block-aligned LRU cache sitting in front of a BinaryReader.
 * The extension host answers webview range requests from here so repeated
 * scroll-backs and inspector reads do not hit the disk again, while total
 * memory stays bounded regardless of file size.
 */
export class BinaryCache {
  private blocks = new Map<number, Uint8Array>();
  private lru: number[] = [];
  private inflight = new Map<number, Promise<Uint8Array>>();

  constructor(
    private readonly reader: BinaryReader,
    private readonly blockSize: number,
    private readonly maxBytes: number,
  ) {}

  get fileSize(): number {
    return this.reader.size;
  }

  private get maxBlocks(): number {
    return Math.max(4, Math.floor(this.maxBytes / this.blockSize));
  }

  async getRange(offset: number, length: number): Promise<Uint8Array> {
    const size = this.reader.size;
    const start = Math.max(0, Math.min(offset, size));
    const end = Math.max(start, Math.min(offset + length, size));
    if (end === start) {
      return new Uint8Array(0);
    }
    const firstBlock = Math.floor(start / this.blockSize);
    const lastBlock = Math.floor((end - 1) / this.blockSize);

    const needed: number[] = [];
    for (let b = firstBlock; b <= lastBlock; b++) {
      if (!this.blocks.has(b)) {
        needed.push(b);
      }
    }
    await Promise.all(needed.map((b) => this.loadBlock(b)));

    const out = new Uint8Array(end - start);
    for (let b = firstBlock; b <= lastBlock; b++) {
      const block = this.blocks.get(b);
      if (!block) {
        continue;
      }
      const blockStart = b * this.blockSize;
      const copyStart = Math.max(start, blockStart);
      const copyEnd = Math.min(end, blockStart + block.byteLength);
      if (copyEnd > copyStart) {
        out.set(block.subarray(copyStart - blockStart, copyEnd - blockStart), copyStart - start);
      }
      this.touch(b);
    }
    return out;
  }

  private loadBlock(b: number): Promise<Uint8Array> {
    const existing = this.blocks.get(b);
    if (existing) {
      return Promise.resolve(existing);
    }
    const pending = this.inflight.get(b);
    if (pending) {
      return pending;
    }
    const p = this.reader
      .read(b * this.blockSize, this.blockSize)
      .then((data) => {
        this.blocks.set(b, data);
        this.lru.push(b);
        this.evict();
        this.inflight.delete(b);
        return data;
      })
      .catch((err) => {
        this.inflight.delete(b);
        throw err;
      });
    this.inflight.set(b, p);
    return p;
  }

  private touch(b: number): void {
    const i = this.lru.indexOf(b);
    if (i >= 0) {
      this.lru.splice(i, 1);
    }
    this.lru.push(b);
  }

  private evict(): void {
    while (this.lru.length > this.maxBlocks) {
      const victim = this.lru.shift();
      if (victim !== undefined) {
        this.blocks.delete(victim);
      }
    }
  }

  clear(): void {
    this.blocks.clear();
    this.lru.length = 0;
  }

  /** Number of blocks currently resident. Exposed for tests/telemetry. */
  get residentBlocks(): number {
    return this.blocks.size;
  }
}
