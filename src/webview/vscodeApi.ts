import type { WebviewToHost, WebviewPersistedState } from '../types/messages';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();

export function post(msg: WebviewToHost): void {
  vscode.postMessage(msg);
}

export function logToHost(level: 'info' | 'warn' | 'error', message: string): void {
  post({ type: 'log', level, message });
}

export function loadState(): Partial<WebviewPersistedState> {
  return vscode.getState<Partial<WebviewPersistedState>>() ?? {};
}

export function saveState(state: Partial<WebviewPersistedState>): void {
  const prev = loadState();
  vscode.setState({ ...prev, ...state });
}
