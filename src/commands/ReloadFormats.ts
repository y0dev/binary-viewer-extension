import * as vscode from 'vscode';
import { FormatManager } from '../formats/FormatManager';

export function registerReloadFormats(formats: FormatManager): vscode.Disposable {
  return vscode.commands.registerCommand('binaryViewer.reloadFormats', async () => {
    await formats.reload();
    void vscode.window.showInformationMessage(
      `Reloaded binary formats (${formats.getAll().length} available).`,
    );
  });
}
