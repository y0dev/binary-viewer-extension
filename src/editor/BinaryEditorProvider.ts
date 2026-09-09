import * as vscode from 'vscode';
import * as path from 'path';
import { BinaryDocument } from './BinaryDocument';
import { FormatManager } from '../formats/FormatManager';
import { getNonce } from '../util/nonce';
import { log } from '../util/logger';
import { parseFormat } from '../core/BinaryParser';
import { computeFieldSize, hasParseTimeSize } from '../core/BinaryField';
import { buildSections } from '../core/Sections';
import { resolveStructures } from '../core/FormatResolve';
import { resolveBaseAddress } from '../core/humanize';
import { searchBinary } from '../binary/BinarySearch';
import type { FieldDefinition, TimestampEpoch } from '../types/format';
import type {
  HostToWebview,
  WebviewToHost,
  ViewerConfig,
  ViewMode,
  WebviewPersistedState,
} from '../types/messages';

const VIEW_TYPE = 'binaryViewer.hexEditor';
const HEADER_MIN_WINDOW = 4096;
const HEADER_MAX_WINDOW = 8 * 1024 * 1024;

interface Entry {
  document: BinaryDocument;
  panel: vscode.WebviewPanel;
  /** Last selection reported by the webview, for commands that act on it. */
  selection?: { offset: number; length: number };
}

interface ResolvedConfig extends ViewerConfig {
  blockSizeBytes: number;
  cacheWindowBytes: number;
  autoDetect: boolean;
  maxArrayElements: number;
  timestampEpoch: TimestampEpoch;
  timestampUTC: boolean;
}

export class BinaryEditorProvider implements vscode.CustomReadonlyEditorProvider<BinaryDocument> {
  private readonly entries = new Set<Entry>();
  private activeEntry: Entry | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly formats: FormatManager,
  ) {
    this.context.subscriptions.push(
      this.formats.onDidChange(() => {
        for (const e of this.entries) {
          const active = e.document.activeFormatName;
          // Drop the active format if its file was removed / renamed away.
          if (active && !this.formats.get(active)) {
            e.document.activeFormatName = null;
          }
          this.post(e, {
            type: 'formats',
            formats: this.formats.summaries(),
            activeFormat: e.document.activeFormatName,
          });
          // Re-decode in place when the applied format's definition changed.
          if (e.document.activeFormatName) {
            void this.doParse(e, e.document.activeFormatName);
          }
        }
      }),
    );
  }

  register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(VIEW_TYPE, this, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  // ----- command surface -------------------------------------------------

  get hasActive(): boolean {
    return this.activeEntry !== undefined;
  }

  postToActive(message: HostToWebview): void {
    if (this.activeEntry) {
      this.post(this.activeEntry, message);
    }
  }

  activeDocument(): BinaryDocument | undefined {
    return this.activeEntry?.document;
  }

  /** Last byte selection in the active editor, if any. */
  activeSelection(): { offset: number; length: number } | undefined {
    const sel = this.activeEntry?.selection;
    return sel && sel.length > 0 ? sel : undefined;
  }

  /** Read a byte range from the active document (for scaffolding a format). */
  async readActive(offset: number, length: number): Promise<Uint8Array | undefined> {
    const doc = this.activeEntry?.document;
    if (!doc) {
      return undefined;
    }
    return doc.cache.getRange(offset, length);
  }

  /** Apply a structure format to the active editor (invoked from a command). */
  async setActiveFormatFromCommand(formatName: string | null): Promise<void> {
    const entry = this.activeEntry;
    if (!entry) {
      return;
    }
    entry.document.activeFormatName = formatName;
    await this.persist(entry, { activeFormat: formatName });
    this.post(entry, {
      type: 'formats',
      formats: this.formats.summaries(),
      activeFormat: formatName,
    });
    if (formatName) {
      await this.doParse(entry, formatName);
      this.post(entry, { type: 'setView', view: 'structure' });
    }
  }

  // ----- CustomReadonlyEditorProvider ----------------------------------

  async openCustomDocument(uri: vscode.Uri): Promise<BinaryDocument> {
    const cfg = this.readConfig();
    const doc = await BinaryDocument.create(uri, {
      blockSizeBytes: cfg.blockSizeBytes,
      cacheWindowBytes: cfg.cacheWindowBytes,
    });
    const saved = this.context.workspaceState.get<WebviewPersistedState>(this.stateKey(uri));
    if (saved?.activeFormat) {
      doc.activeFormatName = saved.activeFormat;
    }
    return doc;
  }

  async resolveCustomEditor(
    document: BinaryDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const entry: Entry = { document, panel };
    this.entries.add(entry);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };
    panel.webview.html = this.buildHtml(panel.webview);

    const setActive = (active: boolean) => {
      if (active) {
        this.activeEntry = entry;
      } else if (this.activeEntry === entry) {
        this.activeEntry = undefined;
      }
      void vscode.commands.executeCommand(
        'setContext',
        'binaryViewer.active',
        this.activeEntry !== undefined,
      );
    };
    setActive(panel.active);

    panel.onDidChangeViewState(() => setActive(panel.active));

    const messageSub = panel.webview.onDidReceiveMessage((msg: WebviewToHost) =>
      this.onMessage(entry, msg),
    );

    const disposeSub = panel.onDidDispose(() => {
      messageSub.dispose();
      disposeSub.dispose();
      this.entries.delete(entry);
      if (this.activeEntry === entry) {
        this.activeEntry = undefined;
        void vscode.commands.executeCommand('setContext', 'binaryViewer.active', false);
      }
      document.dispose();
    });
  }

  // ----- messaging -----------------------------------------------------

  private post(entry: Entry, message: HostToWebview): void {
    void entry.panel.webview.postMessage(message);
  }

  private async onMessage(entry: Entry, msg: WebviewToHost): Promise<void> {
    const { document } = entry;
    try {
      switch (msg.type) {
        case 'ready': {
          const header = await document.cache.getRange(0, HEADER_MIN_WINDOW);
          const candidates = this.readConfig().autoDetect
            ? this.formats.detect(path.basename(document.uri.fsPath), header)
            : [];
          const detected = candidates[0]?.format.name ?? null;
          if (!document.activeFormatName && detected) {
            document.activeFormatName = detected;
          }
          const cfg = this.readConfig();
          this.post(entry, {
            type: 'init',
            fileSize: document.fileSize,
            fileName: path.basename(document.uri.fsPath),
            uriPath: document.uri.toString(),
            config: {
              bytesPerRow: cfg.bytesPerRow,
              defaultEndianness: cfg.defaultEndianness,
              showInspector: cfg.showInspector,
              blockSizeBytes: cfg.blockSizeBytes,
              maxSearchResults: cfg.maxSearchResults,
              defaultView: cfg.defaultView,
              baseAddress: cfg.baseAddress,
            },
            formats: this.formats.summaries(),
            detectedFormat: detected,
            activeFormat: document.activeFormatName,
          });
          break;
        }

        case 'requestRange': {
          const data = await document.cache.getRange(msg.offset, msg.length);
          this.post(entry, {
            type: 'range',
            requestId: msg.requestId,
            offset: msg.offset,
            length: data.byteLength,
            data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
          });
          break;
        }

        case 'requestParse': {
          await this.doParse(entry, msg.formatName, msg.endianness);
          break;
        }

        case 'setActiveFormat': {
          document.activeFormatName = msg.formatName;
          await this.persist(entry, { activeFormat: msg.formatName });
          if (msg.formatName) {
            await this.doParse(entry, msg.formatName, msg.endianness);
          }
          break;
        }

        case 'search': {
          const cfg = this.readConfig();
          const outcome = await searchBinary(document.reader, msg.query, {
            maxResults: cfg.maxSearchResults,
          });
          this.post(entry, {
            type: 'searchResult',
            query: msg.query,
            matches: outcome.matches,
            done: outcome.done,
            scannedTo: outcome.scannedTo,
          });
          break;
        }

        case 'persistState': {
          await this.context.workspaceState.update(this.stateKey(document.uri), msg.state);
          break;
        }

        case 'openFormatEditor': {
          await vscode.commands.executeCommand('binaryViewer.editFormat', msg.formatName);
          break;
        }

        case 'generateFormat': {
          await vscode.commands.executeCommand('binaryViewer.generateFormat');
          break;
        }

        case 'reloadFormats': {
          await vscode.commands.executeCommand('binaryViewer.reloadFormats');
          break;
        }

        case 'selectionChanged':
          entry.selection = { offset: msg.offset, length: msg.length };
          break;

        case 'log':
          log()[msg.level](`[webview] ${msg.message}`);
          break;
      }
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      log().error(`onMessage(${msg.type}) failed: ${message}`);
      this.post(entry, { type: 'error', message });
    }
  }

  private async doParse(
    entry: Entry,
    formatName: string,
    endianness?: 'little' | 'big',
  ): Promise<void> {
    const loaded = this.formats.get(formatName);
    if (!loaded) {
      this.post(entry, {
        type: 'parseResult',
        formatName,
        nodes: [],
        sections: [],
        baseAddress: null,
        error: `Format "${formatName}" not found`,
      });
      return;
    }
    const formatBase =
      loaded.definition.baseAddress !== undefined
        ? resolveBaseAddress(loaded.definition.baseAddress)
        : null;
    // Inline any reusable `structures` before parsing / sizing.
    const { format: def, errors: resolveErrors } = resolveStructures(loaded.definition);

    let extent = HEADER_MIN_WINDOW;
    let cursor = 0;
    let indeterminate = hasParseTimeSize(def.fields as FieldDefinition[] | undefined);
    for (const f of (def.fields ?? []) as FieldDefinition[]) {
      try {
        const at = f.offset ?? cursor;
        const sz = computeFieldSize(f);
        extent = Math.max(extent, at + sz);
        cursor = at + sz;
      } catch {
        indeterminate = true;
      }
    }
    if (indeterminate) {
      // A `countField` / variable-size field means the real extent isn't known
      // until parse time — read as much of the file as the window budget allows
      // so those elements decode instead of showing "outside loaded window".
      extent = entry.document.fileSize;
    }
    const windowLen = Math.min(Math.max(extent, HEADER_MIN_WINDOW), HEADER_MAX_WINDOW, entry.document.fileSize);
    const bytes = await entry.document.cache.getRange(0, windowLen);
    const cfg = this.readConfig();
    const { nodes, error } = parseFormat(
      def,
      { baseOffset: 0, bytes, fileSize: entry.document.fileSize },
      {
        defaultEndianness: endianness ?? cfg.defaultEndianness,
        maxArrayElements: cfg.maxArrayElements,
        timestamp: { epoch: cfg.timestampEpoch, utc: cfg.timestampUTC },
      },
    );
    const sections = buildSections(
      def,
      nodes.map((n) => ({ name: n.name, offset: n.offset, size: n.size, depth: n.depth })),
      entry.document.fileSize,
    );
    const allErrors = [...resolveErrors, error].filter(Boolean).join('; ') || undefined;
    this.post(entry, {
      type: 'parseResult',
      formatName,
      nodes,
      sections,
      baseAddress: formatBase,
      error: allErrors,
    });
  }

  private async persist(entry: Entry, patch: Partial<WebviewPersistedState>): Promise<void> {
    const key = this.stateKey(entry.document.uri);
    const prev = this.context.workspaceState.get<WebviewPersistedState>(key);
    await this.context.workspaceState.update(key, { ...(prev ?? {}), ...patch } as WebviewPersistedState);
  }

  private stateKey(uri: vscode.Uri): string {
    return `binaryViewer.state:${uri.toString()}`;
  }

  // ----- config / html ----------------------------------------------

  private readConfig(): ResolvedConfig {
    const c = vscode.workspace.getConfiguration('binaryViewer');
    const bpr = c.get<number>('bytesPerRow', 16);
    const view = c.get<ViewMode>('defaultView', 'raw');
    const epoch = c.get<TimestampEpoch>('timestamp.defaultEpoch', 'unix');
    return {
      bytesPerRow: (bpr === 8 || bpr === 32 ? bpr : 16) as 8 | 16 | 32,
      defaultEndianness: c.get<'little' | 'big'>('defaultEndianness', 'little'),
      showInspector: c.get<boolean>('showInspectorByDefault', true),
      blockSizeBytes: Math.max(4096, c.get<number>('blockSizeBytes', 65536)),
      cacheWindowBytes: Math.max(262144, c.get<number>('cacheWindowBytes', 8 * 1024 * 1024)),
      maxSearchResults: c.get<number>('maxSearchResults', 5000),
      autoDetect: c.get<boolean>('autoDetectFormat', true),
      defaultView: view === 'structure' || view === 'sections' ? view : 'raw',
      baseAddress: resolveBaseAddress(c.get<string>('baseAddress', '')),
      maxArrayElements: Math.max(0, c.get<number>('structure.maxArrayElements', 1000)),
      timestampEpoch: epoch,
      timestampUTC: c.get<boolean>('timestamp.displayUTC', true),
    };
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'),
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Binary Viewer</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
