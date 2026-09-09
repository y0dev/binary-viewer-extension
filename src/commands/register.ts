import * as vscode from 'vscode';
import { BinaryEditorProvider } from '../editor/BinaryEditorProvider';
import { FormatManager } from '../formats/FormatManager';
import { registerGoToOffset } from './GoToOffset';
import { registerSearchCommands } from './SearchBinary';
import { registerViewCommands } from './ToggleView';
import { registerFormatAuthoringCommands } from './CreateFormat';
import { registerImportExportCommands } from './ImportExportFormat';
import { registerReloadFormats } from './ReloadFormats';

export function registerAllCommands(
  context: vscode.ExtensionContext,
  provider: BinaryEditorProvider,
  formats: FormatManager,
): void {
  const disposables: vscode.Disposable[] = [
    registerGoToOffset(provider),
    ...registerSearchCommands(provider),
    ...registerViewCommands(provider, formats),
    ...registerFormatAuthoringCommands(context, formats),
    ...registerImportExportCommands(formats),
    registerReloadFormats(formats),
    vscode.commands.registerCommand('binaryViewer.openWith', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showInformationMessage('Select a file in the Explorer first.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', target, 'binaryViewer.hexEditor');
    }),
  ];
  context.subscriptions.push(...disposables);
}
