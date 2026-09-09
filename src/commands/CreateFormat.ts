import * as vscode from 'vscode';
import { FormatManager } from '../formats/FormatManager';
import { FormatEditorPanel } from '../formatEditor/FormatEditorPanel';
import type { FormatDefinition } from '../types/format';

const STARTER: FormatDefinition = {
  name: 'New Binary Format',
  description: '',
  endianness: 'little',
  fileExtensions: [],
  fields: [
    { name: 'Magic', type: 'uint32', offset: 0, display: 'hex' },
    { name: 'Version', type: 'uint16', offset: 4 },
  ],
};

async function pickFormat(
  formats: FormatManager,
  title: string,
  onlyWritable: boolean,
): Promise<FormatDefinition | undefined> {
  const all = formats.getAll().filter((f) => (onlyWritable ? f.source !== 'builtin' : true));
  if (all.length === 0) {
    void vscode.window.showInformationMessage(
      onlyWritable ? 'No editable formats yet. Use "Create Binary Format".' : 'No formats available.',
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    all.map((f) => ({ label: f.definition.name, description: f.source, detail: f.definition.description })),
    { title, placeHolder: 'Select a format' },
  );
  return picked ? formats.get(picked.label)?.definition : undefined;
}

export function registerFormatAuthoringCommands(
  context: vscode.ExtensionContext,
  formats: FormatManager,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('binaryViewer.createFormat', () => {
      FormatEditorPanel.show(context, formats, {
        format: structuredClone(STARTER),
        editing: false,
      });
    }),

    vscode.commands.registerCommand('binaryViewer.editFormat', async (nameArg?: string) => {
      let def: FormatDefinition | undefined;
      let editing = true;
      if (typeof nameArg === 'string') {
        const loaded = formats.get(nameArg);
        def = loaded?.definition;
        editing = loaded?.source !== 'builtin';
      } else {
        def = await pickFormat(formats, 'Edit Binary Format', false);
        editing = def ? formats.get(def.name)?.source !== 'builtin' : true;
      }
      if (!def) {
        return;
      }
      if (!editing) {
        // Built-in: open as a new copy so the original stays pristine.
        FormatEditorPanel.show(context, formats, {
          format: { ...structuredClone(def), name: `${def.name} (copy)` },
          editing: false,
        });
        return;
      }
      FormatEditorPanel.show(context, formats, { format: structuredClone(def), editing: true });
    }),

    vscode.commands.registerCommand('binaryViewer.duplicateFormat', async () => {
      const def = await pickFormat(formats, 'Duplicate Binary Format', false);
      if (!def) {
        return;
      }
      FormatEditorPanel.show(context, formats, {
        format: { ...structuredClone(def), name: `${def.name} (copy)` },
        editing: false,
      });
    }),

    vscode.commands.registerCommand('binaryViewer.deleteFormat', async () => {
      const writable = formats.getAll().filter((f) => f.source === 'global');
      if (writable.length === 0) {
        void vscode.window.showInformationMessage('No global formats to delete.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        writable.map((f) => ({ label: f.definition.name, description: f.source })),
        { title: 'Delete Binary Format', placeHolder: 'This removes the global JSON file' },
      );
      if (!picked) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete format "${picked.label}"?`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') {
        return;
      }
      await formats.storage.deleteGlobal(picked.label);
      await formats.reload();
      void vscode.window.showInformationMessage(`Deleted format "${picked.label}".`);
    }),
  ];
}
