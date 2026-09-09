import * as vscode from 'vscode';
import { FormatManager } from '../formats/FormatManager';

export function registerImportExportCommands(formats: FormatManager): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('binaryViewer.importFormat', async () => {
      const picks = await vscode.window.showOpenDialog({
        title: 'Import Binary Format',
        canSelectMany: true,
        filters: { 'Binary format definitions': ['json'] },
      });
      if (!picks || picks.length === 0) {
        return;
      }
      let count = 0;
      for (const uri of picks) {
        try {
          const imported = await formats.storage.importFromFile(uri);
          count += imported.length;
        } catch (e) {
          void vscode.window.showErrorMessage(
            `${uri.path.split('/').pop()}: ${(e as Error).message}`,
          );
        }
      }
      if (count > 0) {
        await formats.reload();
        void vscode.window.showInformationMessage(`Imported ${count} binary format(s).`);
      }
    }),

    vscode.commands.registerCommand('binaryViewer.exportFormat', async () => {
      const all = formats.getAll();
      if (all.length === 0) {
        void vscode.window.showInformationMessage('No formats to export.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        all.map((f) => ({ label: f.definition.name, description: f.source, picked: false })),
        { title: 'Export Binary Format', canPickMany: true, placeHolder: 'Select one or more formats' },
      );
      if (!picked || picked.length === 0) {
        return;
      }
      const defs = picked
        .map((p) => formats.get(p.label)?.definition)
        .filter((d): d is NonNullable<typeof d> => !!d);
      const defaultName = picked.length === 1 ? `${slug(picked[0].label)}.json` : 'binary-formats.json';
      const target = await vscode.window.showSaveDialog({
        title: 'Export Binary Format',
        saveLabel: 'Export',
        defaultUri: vscode.Uri.file(defaultName),
        filters: { JSON: ['json'] },
      });
      if (!target) {
        return;
      }
      await formats.storage.exportToFile(defs, target);
      void vscode.window.showInformationMessage(
        `Exported ${defs.length} format(s) to ${target.fsPath}.`,
      );
    }),
  ];
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'format';
}
