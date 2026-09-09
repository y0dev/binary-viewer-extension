import * as vscode from 'vscode';
import * as path from 'path';
import { log } from '../util/logger';

const VIEW_TYPE = 'binaryViewer.hexEditor';

/**
 * `binaryViewer.additionalExtensions` lets a user route extra file extensions to
 * the Binary Viewer without VS Code's static `customEditors` selector (which
 * can't be extended at runtime). When a plain text editor opens a file whose
 * extension is on the list, we reopen it with our custom editor once.
 *
 * "Once" is deliberate: if the user then reopens it as text (Open With…), we
 * don't fight them for the rest of the session.
 */
export function registerAdditionalExtensions(context: vscode.ExtensionContext): void {
  let exts = readExtensions();
  const redirected = new Set<string>();

  const maybeRedirect = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || exts.size === 0) {
      return;
    }
    const uri = editor.document.uri;
    if (uri.scheme !== 'file') {
      return;
    }
    const ext = path.extname(uri.fsPath).toLowerCase();
    if (!ext || !exts.has(ext)) {
      return;
    }
    const key = uri.toString();
    if (redirected.has(key)) {
      return;
    }
    redirected.add(key);
    void vscode.commands
      .executeCommand('vscode.openWith', uri, VIEW_TYPE)
      .then(undefined, (e) => log().warn(`open-as-binary failed for ${uri.fsPath}: ${String(e)}`));
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(maybeRedirect),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('binaryViewer.additionalExtensions')) {
        exts = readExtensions();
        redirected.clear();
        maybeRedirect(vscode.window.activeTextEditor);
      }
    }),
  );

  // Catch a file that was already open when the extension activated.
  maybeRedirect(vscode.window.activeTextEditor);
}

function readExtensions(): Set<string> {
  const raw = vscode.workspace
    .getConfiguration('binaryViewer')
    .get<string[]>('additionalExtensions', []);
  const out = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const t = entry.trim().toLowerCase();
    if (!t) {
      continue;
    }
    out.add(t.startsWith('.') ? t : '.' + t);
  }
  return out;
}
