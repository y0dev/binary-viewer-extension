import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function initLogger(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Binary Viewer', { log: true });
  }
  return channel;
}

export function log(): vscode.LogOutputChannel {
  return channel ?? initLogger();
}
