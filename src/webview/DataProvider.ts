import { post } from './vscodeApi';

/**
 * Webview-side bounded block cache. Rendering reads synchronously via
 * `peek()` (filling unknown bytes with 0 and reporting `complete=false`), and
 * separately kicks off `prefetch()` which resolves when the requested span has
 * arrived from the host. The full file is never held here.
 */
export class DataProvider {
  private blocks = new Map<number, Uint8Array>();
  private lru: number[] = [];
  private pending = new Map<number, { resolve: () => void; promise: Promise<void> }>();
  private reqSeq = 1;
  /** requestId -> blockIndex */
  private reqToBlock = new Map<number, number>();
  private listeners = new Set<() => void>();

  constructor(
    readonly fileSize: number,
    private readonly blockSize: number,
    private readonly maxBlocks = 96,
  ) {}

  onData(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const l of this.listeners) {
      l();
    }
  }

  /** Synchronous read of [offset, offset+length). Missing bytes are zero. */
  peek(offset: number, length: number): { bytes: Uint8Array; complete: boolean } {
    const start = Math.max(0, Math.min(offset, this.fileSize));
    const end = Math.max(start, Math.min(offset + length, this.fileSize));
    const out = new Uint8Array(end - start);
    let complete = true;
    if (end === start) {
      return { bytes: out, complete: true };
    }
    const first = Math.floor(start / this.blockSize);
    const last = Math.floor((end - 1) / this.blockSize);
    for (let b = first; b <= last; b++) {
      const block = this.blocks.get(b);
      const blockStart = b * this.blockSize;
      if (!block) {
        complete = false;
        continue;
      }
      const copyStart = Math.max(start, blockStart);
      const copyEnd = Math.min(end, blockStart + block.byteLength);
      if (copyEnd > copyStart) {
        out.set(block.subarray(copyStart - blockStart, copyEnd - blockStart), copyStart - start);
      }
      this.touch(b);
    }
    return { bytes: out, complete };
  }

  /** Ensure [offset, offset+length) is cached; resolves when it is. */
  async prefetch(offset: number, length: number): Promise<void> {
    const start = Math.max(0, Math.min(offset, this.fileSize));
    const end = Math.max(start, Math.min(offset + length, this.fileSize));
    if (end === start) {
      return;
    }
    const first = Math.floor(start / this.blockSize);
    const last = Math.floor((end - 1) / this.blockSize);
    const waits: Promise<void>[] = [];
    for (let b = first; b <= last; b++) {
      if (this.blocks.has(b)) {
        continue;
      }
      const existing = this.pending.get(b);
      if (existing) {
        waits.push(existing.promise);
        continue;
      }
      const requestId = this.reqSeq++;
      this.reqToBlock.set(requestId, b);
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      this.pending.set(b, { resolve, promise });
      waits.push(promise);
      post({ type: 'requestRange', requestId, offset: b * this.blockSize, length: this.blockSize });
    }
    await Promise.all(waits);
  }

  /** Called by main.ts when a 'range' message arrives. */
  receive(requestId: number, offset: number, bytes: Uint8Array): void {
    const b = this.reqToBlock.get(requestId);
    this.reqToBlock.delete(requestId);
    const blockIndex = b ?? Math.floor(offset / this.blockSize);
    this.blocks.set(blockIndex, bytes);
    this.lru.push(blockIndex);
    this.evict();
    const p = this.pending.get(blockIndex);
    if (p) {
      this.pending.delete(blockIndex);
      p.resolve();
    }
    this.notify();
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
      if (victim !== undefined && !this.pending.has(victim)) {
        this.blocks.delete(victim);
      }
    }
  }
}
