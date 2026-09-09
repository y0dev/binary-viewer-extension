import * as vscode from 'vscode';
import type { FormatDefinition, LoadedFormat } from '../types/format';
import type { FormatSummary } from '../types/messages';
import { BUILTIN_FORMATS } from './BuiltinFormats';
import { FormatStorage } from './FormatStorage';
import { mergeFormats } from '../core/FormatMerge';
import { detectFormats, DetectionCandidate } from '../core/FormatDetector';
import { log } from '../util/logger';

/**
 * Aggregates format definitions from three sources and resolves precedence:
 *
 *   workspace (.vscode/binary-viewer/formats)  >  global storage  >  builtin
 *
 * A workspace definition replaces a global/builtin one when it collides **by
 * format name OR by JSON file name** — so dropping `firmware.json` into a
 * workspace shadows the global `firmware.json` even if the `name` fields differ.
 *
 * New / edited / deleted files in either location are picked up automatically
 * (debounced file watchers) and via `reload()` (the "Reload Binary Formats"
 * command).
 */
export class FormatManager implements vscode.Disposable {
  readonly storage: FormatStorage;
  private formats: LoadedFormat[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private reloadTimer: NodeJS.Timeout | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.storage = new FormatStorage(context);
  }

  async initialize(): Promise<void> {
    await this.storage.ensureGlobalDir();
    await this.reload();
    this.setupWatchers();
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.setupWatchers();
        this.scheduleReload();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.scheduleReload()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('binaryViewer.formatDirectories') ||
          e.affectsConfiguration('binaryViewer.showBuiltinFormats')
        ) {
          this.setupWatchers();
          this.scheduleReload();
        }
      }),
    );
  }

  private setupWatchers(): void {
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
    for (const glob of this.storage.allWatchableGlobs()) {
      const w = vscode.workspace.createFileSystemWatcher(glob);
      const trigger = () => this.scheduleReload();
      w.onDidChange(trigger);
      w.onDidCreate(trigger);
      w.onDidDelete(trigger);
      this.watchers.push(w);
    }
  }

  /** Coalesce bursts of file events (a save can fire several) into one reload. */
  private scheduleReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      void this.reload();
    }, 150);
  }

  private get showBuiltin(): boolean {
    return vscode.workspace.getConfiguration('binaryViewer').get<boolean>('showBuiltinFormats', true);
  }

  async reload(): Promise<void> {
    const builtin: LoadedFormat[] = this.showBuiltin
      ? BUILTIN_FORMATS.map((definition) => ({ definition, source: 'builtin' as const }))
      : [];
    let global: LoadedFormat[] = [];
    let external: LoadedFormat[] = [];
    let workspace: LoadedFormat[] = [];
    try {
      global = await this.storage.loadGlobal();
    } catch (e) {
      log().error(`Loading global formats failed: ${(e as Error).message}`);
    }
    try {
      external = await this.storage.loadExternal();
    } catch (e) {
      log().error(`Loading external formats failed: ${(e as Error).message}`);
    }
    try {
      workspace = await this.storage.loadWorkspace();
    } catch (e) {
      log().error(`Loading workspace formats failed: ${(e as Error).message}`);
    }

    // Lowest priority first: builtin < global < external < workspace.
    this.formats = mergeFormats([builtin, global, external, workspace]).sort((a, b) =>
      a.definition.name.localeCompare(b.definition.name),
    );
    log().info(
      `Loaded ${this.formats.length} binary formats ` +
        `(${workspace.length} workspace, ${external.length} external, ${global.length} global, ` +
        `${builtin.length} builtin).`,
    );
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
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    for (const w of this.watchers) {
      w.dispose();
    }
    this._onDidChange.dispose();
  }
}
