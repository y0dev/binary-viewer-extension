import * as vscode from 'vscode';
import { getNonce } from '../util/nonce';
import { validateFormat, COMPOSITE_TYPE_NAMES } from '../core/FormatSchema';
import { SCALAR_TYPE_NAMES } from '../core/DataTypes';
import { FormatManager } from '../formats/FormatManager';
import type { FormatDefinition } from '../types/format';
import type { FormatEditorToHost, FormatEditorFromHost } from '../types/messages';

/**
 * A singleton webview panel that provides a form-based editor for binary format
 * definitions. Definitions are pure data; nothing entered here is executed.
 */
export class FormatEditorPanel {
  private static instance: FormatEditorPanel | undefined;

  static show(
    context: vscode.ExtensionContext,
    formats: FormatManager,
    initial: { format: FormatDefinition | null; editing: boolean },
  ): void {
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

  private pending: { format: FormatDefinition | null; editing: boolean };

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly formats: FormatManager,
    initial: { format: FormatDefinition | null; editing: boolean },
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

  private load(initial: { format: FormatDefinition | null; editing: boolean }): void {
    this.pending = initial;
    this.send({
      type: 'init',
      format: initial.format,
      editing: initial.editing,
      scalarTypes: SCALAR_TYPE_NAMES,
      compositeTypes: COMPOSITE_TYPE_NAMES,
    });
  }

  private send(message: FormatEditorFromHost): void {
    void this.panel.webview.postMessage(message);
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
        const previousName = this.pending.editing ? this.pending.format?.name : undefined;
        try {
          const uri = await this.formats.storage.saveGlobal(msg.format, previousName);
          await this.formats.reload();
          this.pending = { format: msg.format, editing: true };
          this.send({ type: 'saved' });
          const open = 'Open JSON';
          const choice = await vscode.window.showInformationMessage(
            `Saved binary format "${msg.format.name}".`,
            open,
          );
          if (choice === open) {
            await vscode.window.showTextDocument(uri);
          }
        } catch (e) {
          void vscode.window.showErrorMessage(`Failed to save format: ${(e as Error).message}`);
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
