import * as vscode from 'vscode';
import { initLogger, log } from './util/logger';
import { FormatManager } from './formats/FormatManager';
import { BinaryEditorProvider } from './editor/BinaryEditorProvider';
import { registerAllCommands } from './commands/register';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(initLogger());
  log().info('Binary Viewer activating');

  const formats = new FormatManager(context);
  context.subscriptions.push(formats);
  await formats.initialize();

  const provider = new BinaryEditorProvider(context, formats);
  context.subscriptions.push(provider.register());

  registerAllCommands(context, provider, formats);

  log().info('Binary Viewer activated');
}

export function deactivate(): void {
  log().info('Binary Viewer deactivated');
}
