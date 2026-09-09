import * as vscode from 'vscode';
import * as path from 'path';
import { BinaryEditorProvider } from '../editor/BinaryEditorProvider';
import { FormatManager } from '../formats/FormatManager';
import { validateFormat } from '../core/FormatSchema';
import { offsetHex, parseNumericInput } from '../core/humanize';
import {
  scaffoldArray,
  scaffoldSingleField,
  scaffoldWholeFile,
  suggestElementSize,
  SCAFFOLD_SCALARS,
  ArrayElementKind,
} from '../core/FormatScaffold';
import type { FormatDefinition } from '../types/format';

export function registerGenerateFormat(
  provider: BinaryEditorProvider,
  formats: FormatManager,
): vscode.Disposable {
  return vscode.commands.registerCommand('binaryViewer.generateFormat', async () => {
    const doc = provider.activeDocument();
    if (!doc) {
      void vscode.window.showInformationMessage('Open a file in the Binary Viewer first.');
      return;
    }

    const baseName = path.basename(doc.uri.fsPath).replace(/\.[^.]+$/, '');
    const fileName = path.basename(doc.uri.fsPath);
    const sel = provider.activeSelection();
    const header = (await provider.readActive(0, 16)) ?? new Uint8Array(0);

    // ---- scope --------------------------------------------------------
    const scopeItems: (vscode.QuickPickItem & { id: 'selection' | 'file' })[] = [];
    if (sel && sel.length > 1) {
      scopeItems.push({
        id: 'selection',
        label: '$(list-selection) From the current selection',
        detail: `${sel.length} bytes at ${offsetHex(sel.offset)} — best for large repeating data`,
      });
    }
    scopeItems.push({
      id: 'file',
      label: '$(file-binary) Whole-file skeleton',
      detail: 'magic + a header/body placeholder to fill in',
    });
    const scope =
      scopeItems.length === 1
        ? scopeItems[0]
        : await vscode.window.showQuickPick(scopeItems, {
            title: 'Generate Binary Format',
            placeHolder: 'What should the scaffold cover?',
          });
    if (!scope) {
      return;
    }

    // ---- name -------------------------------------------------------
    const name = await vscode.window.showInputBox({
      title: 'Generate Binary Format',
      prompt: 'Name for the new format',
      value: `${baseName} (draft)`,
      validateInput: (v) => (v.trim() ? undefined : 'A name is required'),
    });
    if (name === undefined) {
      return;
    }

    let def: FormatDefinition;
    let note = '';

    if (scope.id === 'file') {
      const wantMagic = await yesNo('Add a magic-byte signature from the first 4 bytes?', true);
      if (wantMagic === undefined) {
        return;
      }
      def = scaffoldWholeFile({
        name,
        fileName,
        fileSize: doc.fileSize,
        header,
        includeMagic: wantMagic,
      });
    } else {
      const decode = await pickDecode(sel!.length);
      if (!decode) {
        return;
      }
      if (decode.mode === 'single') {
        def = scaffoldSingleField({
          name,
          fileName,
          start: sel!.offset,
          size: sel!.length,
          type: decode.type,
        });
      } else {
        let element: ArrayElementKind;
        if (decode.mode === 'scalar') {
          element = { kind: 'scalar', type: decode.type };
        } else {
          const sizeStr = await vscode.window.showInputBox({
            title: 'Record size',
            prompt: `Bytes per record (selection is ${sel!.length} bytes)`,
            value: String(suggestElementSize(sel!.length)),
            validateInput: (v) => {
              const n = parseNumericInput(v);
              return n && n > 0 ? undefined : 'Enter a positive integer (decimal or 0x…)';
            },
          });
          if (sizeStr === undefined) {
            return;
          }
          const recordSize = parseNumericInput(sizeStr)!;
          element =
            decode.mode === 'struct'
              ? { kind: 'struct', recordSize }
              : { kind: 'bytes', recordSize };
        }
        const result = scaffoldArray({
          name,
          fileName,
          start: sel!.offset,
          totalBytes: sel!.length,
          element,
        });
        def = result.format;
        note = ` — array of ${result.count} x ${result.elementSize} bytes${
          result.remainder ? `, ${result.remainder} trailing bytes ignored` : ''
        }`;
      }
    }

    const check = validateFormat(def);
    if (!check.valid) {
      void vscode.window.showErrorMessage(
        `Generated format did not validate:\n${check.errors.join('\n')}`,
      );
      return;
    }

    let uri: vscode.Uri;
    try {
      uri = await formats.storage.saveGlobal(def);
    } catch (e) {
      void vscode.window.showErrorMessage(`Could not save the format: ${(e as Error).message}`);
      return;
    }
    await formats.reload();
    await provider.setActiveFormatFromCommand(def.name);

    const openJson = 'Edit JSON';
    const openEditor = 'Open in Format Editor';
    const choice = await vscode.window.showInformationMessage(
      `Generated "${def.name}"${note}. Now refine the fields by hand.`,
      openJson,
      openEditor,
    );
    if (choice === openJson) {
      const editor = await vscode.window.showTextDocument(uri, { preview: false });
      // Nudge to the "items" template so array edits are one keystroke away.
      const text = editor.document.getText();
      const idx = text.indexOf('"items"');
      if (idx >= 0) {
        const pos = editor.document.positionAt(idx);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    } else if (choice === openEditor) {
      await vscode.commands.executeCommand('binaryViewer.editFormat', def.name);
    }
  });
}

async function yesNo(prompt: string, dflt: boolean): Promise<boolean | undefined> {
  const yes = { label: 'Yes' };
  const no = { label: 'No' };
  const picked = await vscode.window.showQuickPick(dflt ? [yes, no] : [no, yes], {
    title: prompt,
  });
  if (!picked) {
    return undefined;
  }
  return picked.label === 'Yes';
}

type DecodeChoice =
  | { mode: 'scalar'; type: (typeof SCAFFOLD_SCALARS)[number] }
  | { mode: 'bytes' }
  | { mode: 'struct' }
  | { mode: 'single'; type: string };

async function pickDecode(selLength: number): Promise<DecodeChoice | undefined> {
  const items: (vscode.QuickPickItem & { choice: DecodeChoice })[] = [
    {
      label: '$(symbol-array) Array of a scalar type',
      detail: 'e.g. uint16[] — count is computed from the selection length',
      choice: { mode: 'scalar', type: 'uint16' },
    },
    {
      label: '$(symbol-array) Array of opaque byte records',
      detail: 'you give the record size; items = { type: "bytes", size: N }',
      choice: { mode: 'bytes' },
    },
    {
      label: '$(symbol-array) Array of struct records',
      detail: 'you give the record size; a struct stub to fill in',
      choice: { mode: 'struct' },
    },
    {
      label: `$(symbol-field) Single field covering all ${selLength} bytes`,
      choice: { mode: 'single', type: 'bytes' },
    },
  ];
  const top = await vscode.window.showQuickPick(items, {
    title: 'How should the selected bytes be decoded?',
    placeHolder: 'Arrays are ideal for large repeating data',
  });
  if (!top) {
    return undefined;
  }
  if (top.choice.mode === 'scalar') {
    const t = await vscode.window.showQuickPick([...SCAFFOLD_SCALARS], {
      title: 'Scalar type for each element',
    });
    return t ? { mode: 'scalar', type: t as (typeof SCAFFOLD_SCALARS)[number] } : undefined;
  }
  if (top.choice.mode === 'single') {
    const t = await vscode.window.showQuickPick(
      ['bytes', 'ascii', ...SCAFFOLD_SCALARS],
      { title: 'Type for the single field' },
    );
    return t ? { mode: 'single', type: t } : undefined;
  }
  return top.choice;
}
