import * as vscode from 'vscode';
import { BinaryEditorProvider } from '../editor/BinaryEditorProvider';

export function registerSearchCommands(provider: BinaryEditorProvider): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('binaryViewer.search', () => {
      if (!provider.hasActive) {
        void vscode.window.showInformationMessage('Open a file in the Binary Viewer first.');
        return;
      }
      // The webview owns the search UI (kind picker, incremental results, nav).
      provider.postToActive({ type: 'focusSearch' });
    }),
    vscode.commands.registerCommand('binaryViewer.findNext', () => {
      provider.postToActive({ type: 'searchNav', direction: 'next' });
    }),
    vscode.commands.registerCommand('binaryViewer.findPrevious', () => {
      provider.postToActive({ type: 'searchNav', direction: 'previous' });
    }),
  ];
}
