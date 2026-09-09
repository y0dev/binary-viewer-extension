import * as vscode from 'vscode';
import { BinaryEditorProvider } from '../editor/BinaryEditorProvider';
import { FormatManager } from '../formats/FormatManager';
import { validateFormatText } from '../core/FormatSchema';
import { isFormatFilePath } from '../core/FormatMerge';
import { log } from '../util/logger';

const analyse = validateFormatText;

export function registerFormatFileActions(
  context: vscode.ExtensionContext,
  provider: BinaryEditorProvider,
  formats: FormatManager,
): void {
  const globalFormatsDir = formats.storage.globalDir.fsPath;
  const isFormatFile = (uri: vscode.Uri | undefined): boolean => {
    if (!uri) {
      return false;
    }
    const extra = formats.storage.externalDirs().map((d) => d.fsPath);
    return isFormatFilePath(uri.fsPath, globalFormatsDir, extra);
  };

  const diagnostics = vscode.languages.createDiagnosticCollection('binaryViewer.formatFile');
  context.subscriptions.push(diagnostics);

  const refreshContextKey = (editor = vscode.window.activeTextEditor) => {
    void vscode.commands.executeCommand(
      'setContext',
      'binaryViewer.formatFileOpen',
      isFormatFile(editor?.document.uri),
    );
  };
  refreshContextKey();

  /** Write validation results into the Problems panel for this file. */
  const publishDiagnostics = (uri: vscode.Uri, result: ReturnType<typeof analyse>) => {
    if (result.ok && result.warnings.length === 0) {
      diagnostics.delete(uri);
      return;
    }
    const at = new vscode.Range(0, 0, 0, 1);
    const items = [
      ...result.errors.map((m) => new vscode.Diagnostic(at, m, vscode.DiagnosticSeverity.Error)),
      ...result.warnings.map((m) => new vscode.Diagnostic(at, m, vscode.DiagnosticSeverity.Warning)),
    ];
    for (const d of items) {
      d.source = 'Binary Viewer';
    }
    diagnostics.set(uri, items);
  };

  const resolveDoc = async (
    arg: vscode.Uri | undefined,
  ): Promise<vscode.TextDocument | undefined> => {
    if (arg) {
      return vscode.workspace.openTextDocument(arg);
    }
    return vscode.window.activeTextEditor?.document;
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => refreshContextKey(e)),

    // Re-validate on save so the Problems panel stays in sync with the file.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isFormatFile(doc.uri)) {
        publishDiagnostics(doc.uri, analyse(doc.getText()));
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),

    vscode.commands.registerCommand(
      'binaryViewer.validateFormatFile',
      async (arg?: vscode.Uri) => {
        const doc = await resolveDoc(arg);
        if (!doc) {
          void vscode.window.showInformationMessage('Open a binary-format JSON file first.');
          return;
        }
        const result = analyse(doc.getText());
        publishDiagnostics(doc.uri, result);

        if (result.ok) {
          const label = result.names.length ? `"${result.names.join('", "')}"` : 'format';
          const suffix = result.warnings.length ? ` (${result.warnings.length} warning(s))` : '';
          void vscode.window.showInformationMessage(`Valid ${label}${suffix}.`);
          if (result.warnings.length) {
            log().warn(`${doc.uri.fsPath}\n  ${result.warnings.join('\n  ')}`);
          }
        } else {
          log().error(`${doc.uri.fsPath}\n  ${result.errors.join('\n  ')}`);
          const show = 'Show Details';
          const choice = await vscode.window.showErrorMessage(
            `${result.errors.length} problem(s) in this format file. First: ${result.errors[0]}`,
            show,
          );
          if (choice === show) {
            log().show(true);
          }
        }
      },
    ),

    vscode.commands.registerCommand(
      'binaryViewer.applyFormatFile',
      async (arg?: vscode.Uri) => {
        const doc = await resolveDoc(arg);
        if (!doc) {
          void vscode.window.showInformationMessage('Open a binary-format JSON file first.');
          return;
        }
        const result = analyse(doc.getText());
        publishDiagnostics(doc.uri, result);
        if (!result.ok) {
          void vscode.window.showErrorMessage(
            `Can't apply — this format file has errors. First: ${result.errors[0]}`,
          );
          return;
        }
        if (doc.isDirty) {
          await doc.save();
        }
        await formats.reload();

        const loaded = formats.getAll().find((f) => f.uri === doc.uri.toString());
        if (!loaded) {
          void vscode.window.showWarningMessage(
            'Reloaded, but this file is not in a scanned formats folder — move it under ' +
              '.vscode/binary-viewer/formats/ or the global formats folder.',
          );
          return;
        }
        if (provider.hasActive) {
          await provider.setActiveFormatFromCommand(loaded.definition.name);
          void vscode.window.showInformationMessage(
            `Applied "${loaded.definition.name}" to the open binary.`,
          );
        } else {
          void vscode.window.showInformationMessage(
            `Reloaded. "${loaded.definition.name}" is now available.`,
          );
        }
      },
    ),
  );

  // Clickable lenses at the top of any format JSON file.
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'json', scheme: 'file' },
      {
        provideCodeLenses(document) {
          if (!isFormatFile(document.uri)) {
            return [];
          }
          const top = new vscode.Range(0, 0, 0, 0);
          return [
            new vscode.CodeLens(top, {
              title: '$(check) Validate',
              command: 'binaryViewer.validateFormatFile',
              arguments: [document.uri],
            }),
            new vscode.CodeLens(top, {
              title: '$(sync) Apply to open binary',
              command: 'binaryViewer.applyFormatFile',
              arguments: [document.uri],
            }),
          ];
        },
      },
    ),
  );
}
