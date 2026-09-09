import * as vscode from 'vscode';
import type { FormatDefinition, LoadedFormat } from '../types/format';
import type { FormatSummary } from '../types/messages';
import { BUILTIN_FORMATS } from './BuiltinFormats';
import { FormatStorage } from './FormatStorage';
import { detectFormats, DetectionCandidate } from '../core/FormatDetector';
import { log } from '../util/logger';

/**
 * Aggregates formats from three sources and resolves precedence:
 *   workspace  >  global  >  builtin
 * A workspace format with the same name as a global/builtin one replaces it.
 */
export class FormatManager implements vscode.Disposable {
  readonly storage: FormatStorage;
  private formats: LoadedFormat[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.storage = new FormatStorage(context);
  }

  async initialize(): Promise<void> {
    await this.reload();
    this.setupWatchers();
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.setupWatchers();
        void this.reload();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.reload()),
    );
  }

  private setupWatchers(): void {
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
    for (const glob of this.storage.allWatchableGlobs()) {
      const w = vscode.workspace.createFileSystemWatcher(glob);
      const trigger = () => void this.reload();
      w.onDidChange(trigger);
      w.onDidCreate(trigger);
      w.onDidDelete(trigger);
      this.watchers.push(w);
    }
  }

  async reload(): Promise<void> {
    const builtin: LoadedFormat[] = BUILTIN_FORMATS.map((definition) => ({
      definition,
      source: 'builtin',
    }));
    let global: LoadedFormat[] = [];
    let workspace: LoadedFormat[] = [];
    try {
      global = await this.storage.loadGlobal();
    } catch (e) {
      log().error(`Loading global formats failed: ${(e as Error).message}`);
    }
    try {
      workspace = await this.storage.loadWorkspace();
    } catch (e) {
      log().error(`Loading workspace formats failed: ${(e as Error).message}`);
    }

    const byName = new Map<string, LoadedFormat>();
    for (const f of [...builtin, ...global, ...workspace]) {
      byName.set(f.definition.name, f); // later wins => workspace overrides global overrides builtin
    }
    this.formats = [...byName.values()].sort((a, b) =>
      a.definition.name.localeCompare(b.definition.name),
    );
    log().info(`Loaded ${this.formats.length} binary formats (${workspace.length} workspace, ${global.length} global, ${builtin.length} builtin).`);
    this._onDidChange.fire();
  }

  getAll(): LoadedFormat[] {
    return this.formats;
  }

  getDefinitions(): FormatDefinition[] {
    return this.formats.map((f) => f.definition);
  }

  get(name: string): LoadedFormat | undefined {
    return this.formats.find((f) => f.definition.name === name);
  }

  summaries(): FormatSummary[] {
    return this.formats.map((f) => ({
      name: f.definition.name,
      description: f.definition.description,
      source: f.source,
      fileExtensions: f.definition.fileExtensions,
    }));
  }

  detect(fileName: string, header: Uint8Array): DetectionCandidate[] {
    return detectFormats(this.getDefinitions(), fileName, header);
  }

  dispose(): void {
    for (const w of this.watchers) {
      w.dispose();
    }
    this._onDidChange.dispose();
  }
}
