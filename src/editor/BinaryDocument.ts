import * as vscode from 'vscode';
import { BinaryReader } from '../binary/BinaryReader';
import { BinaryCache } from '../binary/BinaryCache';

export interface BinaryDocumentConfig {
  blockSizeBytes: number;
  cacheWindowBytes: number;
}

/**
 * A CustomDocument backed by a range reader + bounded cache. It holds no file
 * contents itself; everything is read lazily through `cache`.
 */
export class BinaryDocument implements vscode.CustomDocument {
  static async create(
    uri: vscode.Uri,
    config: BinaryDocumentConfig,
  ): Promise<BinaryDocument> {
    const reader = await BinaryReader.create(uri);
    const cache = new BinaryCache(reader, config.blockSizeBytes, config.cacheWindowBytes);
    return new BinaryDocument(uri, reader, cache);
  }

  /** Currently applied structure format name, or null for raw-only. */
  activeFormatName: string | null = null;

  private readonly _onDidDispose = new vscode.EventEmitter<void>();
  readonly onDidDispose = this._onDidDispose.event;

  private constructor(
    readonly uri: vscode.Uri,
    readonly reader: BinaryReader,
    readonly cache: BinaryCache,
  ) {}

  get fileSize(): number {
    return this.reader.size;
  }

  dispose(): void {
    void this.reader.dispose();
    this._onDidDispose.fire();
    this._onDidDispose.dispose();
  }
}
