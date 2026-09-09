import * as vscode from 'vscode';
import { BinaryEditorProvider } from '../editor/BinaryEditorProvider';
import { parseNumericInput, offsetHex } from '../core/humanize';

export function registerGoToOffset(provider: BinaryEditorProvider): vscode.Disposable {
  return vscode.commands.registerCommand('binaryViewer.goToOffset', async () => {
    const doc = provider.activeDocument();
    if (!doc) {
      void vscode.window.showInformationMessage('Open a file in the Binary Viewer first.');
      return;
    }
    const input = await vscode.window.showInputBox({
      title: 'Go To Offset',
      prompt: `Enter an offset (0x1000, 4096, 1000h). File size: ${doc.fileSize} bytes.`,
      placeHolder: '0x1000',
      validateInput: (value) => {
        const n = parseNumericInput(value);
        if (n === undefined) {
          return 'Not a valid number';
        }
        if (n >= doc.fileSize) {
          return `Offset ${offsetHex(n)} is past end of file (${offsetHex(doc.fileSize)})`;
        }
        return undefined;
      },
    });
    if (input === undefined) {
      return;
    }
    const offset = parseNumericInput(input);
    if (offset !== undefined) {
      provider.postToActive({ type: 'gotoOffset', offset });
    }
  });
}
