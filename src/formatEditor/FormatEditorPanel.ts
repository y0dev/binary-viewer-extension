import * as vscode from 'vscode';
import { getNonce } from '../util/nonce';
import { validateFormat, COMPOSITE_TYPE_NAMES } from '../core/FormatSchema';
import { SCALAR_TYPE_NAMES } from '../core/DataTypes';
import { FormatManager } from '../formats/FormatManager';
import { slugify } from '../formats/FormatStorage';
import type { FormatDefinition } from '../types/format';
import type { FormatEditorToHost, FormatEditorFromHost } from '../types/messages';

interface ShowOptions {
  format: FormatDefinition | null;
  editing: boolean;
  /** The backing file, when this definition is already tied to one on disk. */
  sourceUri?: vscode.Uri;
}

/**
 * A singleton webview panel that provides a form-based editor for binary format
 * definitions. Definitions are pure data; nothing entered here is executed.
 */
export class FormatEditorPanel {
  private static instance: FormatEditorPanel | undefined;

  static show(context: vscode.ExtensionContext, formats: FormatManager, initial: ShowOptions): void {
    const column = vscode.ViewColumn.Active;
    if (FormatEditorPanel.instance) {
      FormatEditorPanel.instance.panel.reveal(column);
      FormatEditorPanel.instance.load(initial);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'binaryViewer.formatEditor',
      'Binary Format Editor',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      },
    );
    FormatEditorPanel.instance = new FormatEditorPanel(panel, context, formats, initial);
  }

  private pending: ShowOptions;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly formats: FormatManager,
    initial: ShowOptions,
  ) {
    this.pending = initial;
    this.panel.webview.html = this.html(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((msg: FormatEditorToHost) => this.onMessage(msg));
    this.panel.onDidDispose(() => {
      if (FormatEditorPanel.instance === this) {
        FormatEditorPanel.instance = undefined;
      }
    });
  }

  private load(initial: ShowOptions): void {
    this.pending = initial;
    this.send({
      type: 'init',
      format: initial.format,
      editing: initial.editing,
      scalarTypes: SCALAR_TYPE_NAMES,
      compositeTypes: COMPOSITE_TYPE_NAMES,
      sourcePath: initial.sourceUri ? this.displayPath(initial.sourceUri) : null,
    });
  }

  private send(message: FormatEditorFromHost): void {
    void this.panel.webview.postMessage(message);
  }

  private displayPath(uri: vscode.Uri): string {
    return uri.scheme === 'file' ? uri.fsPath : uri.toString();
  }

  /**
   * Validated save: writes to the known backing file, if any, otherwise to
   * global storage (adopting the result as the backing file from then on).
   */
  private async persist(format: FormatDefinition): Promise<void> {
    try {
      let uri: vscode.Uri;
      if (this.pending.sourceUri) {
        uri = this.pending.sourceUri;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(format, null, 2) + '\n', 'utf8'));
      } else {
        const previousName = this.pending.editing ? this.pending.format?.name : undefined;
        uri = await this.formats.storage.saveGlobal(format, previousName);
      }
      await this.formats.reload();
      this.pending = { format, editing: true, sourceUri: uri };
      this.send({ type: 'saved', sourcePath: this.displayPath(uri) });
      const open = 'Open JSON';
      const choice = await vscode.window.showInformationMessage(`Saved binary format "${format.name}".`, open);
      if (choice === open) {
        await vscode.window.showTextDocument(uri);
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`Failed to save format: ${(e as Error).message}`);
    }
  }

  /**
   * Save-despite-errors safety net: always a *separate* global-storage copy,
   * so a draft that doesn't validate yet never overwrites a known real file
   * (workspace / external / already tied to this editor).
   */
  private async persistDraft(format: FormatDefinition, valid: boolean): Promise<void> {
    try {
      const uri = await this.formats.storage.saveGlobal(format, undefined);
      await this.formats.reload();
      const keepsRealFileAsTarget = !!this.pending.sourceUri;
      if (!keepsRealFileAsTarget) {
        this.pending = { format, editing: true, sourceUri: uri };
      }
      const shownUri = keepsRealFileAsTarget ? this.pending.sourceUri! : uri;
      this.send({ type: 'saved', sourcePath: this.displayPath(shownUri) });
      const problems = valid ? '' : ' (has validation problems — fix before using it)';
      const msg = keepsRealFileAsTarget
        ? `Saved a draft copy to global storage${problems}. The file this editor is tied to ` +
          'is untouched — use Save to write there.'
        : `Saved draft "${format.name}" to global storage${problems}.`;
      const open = 'Open Draft JSON';
      const choice = valid
        ? await vscode.window.showInformationMessage(msg, open)
        : await vscode.window.showWarningMessage(msg, open);
      if (choice === open) {
        await vscode.window.showTextDocument(uri);
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`Failed to save draft: ${(e as Error).message}`);
    }
  }

  private async onMessage(msg: FormatEditorToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.load(this.pending);
        break;

      case 'validate': {
        const result = validateFormat(msg.format);
        this.send({ type: 'validationResult', errors: [...result.errors, ...result.warnings.map((w) => `warning: ${w}`)] });
        break;
      }

      case 'save': {
        const result = validateFormat(msg.format);
        if (!result.valid) {
          this.send({ type: 'validationResult', errors: result.errors });
          void vscode.window.showErrorMessage('Binary format is not valid. See the editor for details.');
          return;
        }
        await this.persist(msg.format);
        break;
      }

      case 'saveDraft': {
        const draft = { ...msg.format };
        if (typeof draft.name !== 'string' || draft.name.trim() === '') {
          draft.name = 'Untitled draft';
        }
        const result = validateFormat(draft);
        this.send({
          type: 'validationResult',
          errors: [...result.errors, ...result.warnings.map((w) => `warning: ${w}`)],
        });
        await this.persistDraft(draft, result.valid);
        break;
      }

      case 'openJsonFile': {
        const picks = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Edit this format',
          filters: { 'Binary format JSON': ['json'] },
        });
        if (!picks || picks.length === 0) {
          return;
        }
        try {
          const raw = await vscode.workspace.fs.readFile(picks[0]);
          const parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
          const def = (Array.isArray(parsed) ? parsed[0] : parsed) as FormatDefinition;
          this.load({ format: def, editing: true, sourceUri: picks[0] });
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Couldn't read that format JSON: ${(e as Error).message}`,
          );
        }
        break;
      }

      case 'changeSavePath': {
        const suggestedName = `${slugify(msg.format.name)}.json`;
        const target = await vscode.window.showSaveDialog({
          defaultUri: this.pending.sourceUri
            ? this.pending.sourceUri
            : vscode.Uri.joinPath(this.formats.storage.globalDir, suggestedName),
          filters: { 'Binary format JSON': ['json'] },
          saveLabel: 'Save format here',
        });
        if (!target) {
          return;
        }
        try {
          await vscode.workspace.fs.writeFile(
            target,
            Buffer.from(JSON.stringify(msg.format, null, 2) + '\n', 'utf8'),
          );
          await this.formats.reload();
          this.pending = { format: msg.format, editing: true, sourceUri: target };
          this.send({ type: 'saved', sourcePath: this.displayPath(target) });
          void vscode.window.showInformationMessage(
            `"${msg.format.name}" now saves to ${this.displayPath(target)}.`,
          );
        } catch (e) {
          void vscode.window.showErrorMessage(`Couldn't write that file: ${(e as Error).message}`);
        }
        break;
      }

      case 'cancel':
        this.panel.dispose();
        break;
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'formatEditor.js'),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Binary Format Editor</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
