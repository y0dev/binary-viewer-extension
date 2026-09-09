import type * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Range-based reader for a single file. Never loads the whole file for `file:`
 * URIs — it keeps one OS file handle open and issues positioned reads.
 *
 * For non-`file:` schemes (virtual/remote file systems that have no range API)
 * it falls back to a one-time full read, but only when the file is small enough
 * that this is safe.
 */
export class BinaryReader {
  private constructor(
    readonly uri: vscode.Uri,
    readonly size: number,
    private handle: fs.promises.FileHandle | undefined,
    private fallback: Uint8Array | undefined,
  ) {}

  static async create(uri: vscode.Uri): Promise<BinaryReader> {
    if (uri.scheme === 'file') {
      const stat = await fs.promises.stat(uri.fsPath);
      const handle = await fs.promises.open(uri.fsPath, 'r');
      return new BinaryReader(uri, stat.size, handle, undefined);
    }
    // Only reached for virtual/remote file systems: load lazily so this module
    // stays importable outside the extension host (e.g. in unit tests).
    const vscode = await import('vscode');
    const stat = await vscode.workspace.fs.stat(uri);
    const FALLBACK_LIMIT = 64 * 1024 * 1024;
    if (stat.size > FALLBACK_LIMIT) {
      throw new Error(
        `The file system for "${uri.toString()}" does not support range reads and the file ` +
          `(${stat.size} bytes) is larger than the ${FALLBACK_LIMIT}-byte fallback limit.`,
      );
    }
    const data = await vscode.workspace.fs.readFile(uri);
    return new BinaryReader(uri, stat.size, undefined, data);
  }

  /**
   * Read up to `length` bytes starting at `offset`. The returned array is
   * clamped to the file bounds and may be shorter than requested near EOF.
   */
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0) {
      offset = 0;
    }
    const want = Math.min(length, Math.max(0, this.size - offset));
    if (want <= 0) {
      return new Uint8Array(0);
    }
    if (this.fallback) {
      return this.fallback.subarray(offset, offset + want);
    }
    const buf = Buffer.allocUnsafe(want);
    const { bytesRead } = await this.handle!.read(buf, 0, want, offset);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  }

  async dispose(): Promise<void> {
    const h = this.handle;
    this.handle = undefined;
    this.fallback = undefined;
    if (h) {
      try {
        await h.close();
      } catch {
        /* ignore */
      }
    }
  }
}
