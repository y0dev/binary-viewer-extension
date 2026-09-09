import * as vscode from 'vscode';
import { BinaryEditorProvider } from '../editor/BinaryEditorProvider';
import { FormatManager } from '../formats/FormatManager';

export function registerViewCommands(
  provider: BinaryEditorProvider,
  formats: FormatManager,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('binaryViewer.toggleStructureView', () => {
      provider.postToActive({ type: 'toggleView', target: 'structure' });
    }),
    vscode.commands.registerCommand('binaryViewer.toggleSectionsView', () => {
      provider.postToActive({ type: 'toggleView', target: 'sections' });
    }),
    vscode.commands.registerCommand('binaryViewer.toggleInspector', () => {
      provider.postToActive({ type: 'toggleInspector' });
    }),
    vscode.commands.registerCommand('binaryViewer.showFieldInRawView', () => {
      provider.postToActive({ type: 'showFieldInRaw' });
    }),
    vscode.commands.registerCommand('binaryViewer.selectFormat', async () => {
      if (!provider.hasActive) {
        void vscode.window.showInformationMessage('Open a file in the Binary Viewer first.');
        return;
      }
      const items: vscode.QuickPickItem[] = [
        { label: '$(circle-slash) None (raw only)', description: 'Disable structure decoding' },
        ...formats.getAll().map((f) => ({
          label: f.definition.name,
          description: f.source,
          detail: f.definition.description,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Select Binary Format',
        placeHolder: 'Choose a structure format to apply to this file',
      });
      if (!picked) {
        return;
      }
      const name = picked.label.startsWith('$(circle-slash)') ? null : picked.label;
      await provider.setActiveFormatFromCommand(name);
    }),
  ];
}
