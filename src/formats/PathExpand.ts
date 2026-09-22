import * as path from 'path';

const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Expand `~` and `${workspaceFolder}` in a user-configured directory path,
 * then resolve `.`/`..` segments — so a documented pattern like
 * `"${workspaceFolder}/../shared"` (a folder that's a sibling of the
 * workspace) actually reaches its target, instead of being passed through as
 * a literal, unresolved path. Leaves an actual URI (`scheme://…`) alone.
 *
 * No `vscode` import (unlike `FormatStorage.expandDirPath`, which supplies
 * `homeDir`/`workspaceFsPath` from the live environment) — pure and
 * unit-testable.
 */
export function expandConfiguredPath(
  input: string,
  homeDir: string,
  workspaceFsPath: string | undefined,
): string {
  let p = input.trim();
  if (p === '') {
    return p;
  }
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = homeDir + p.slice(1);
  }
  if (workspaceFsPath) {
    p = p.replace(/\$\{workspaceFolder\}/g, workspaceFsPath);
  }
  return URI_SCHEME_RE.test(p) ? p : path.resolve(p);
}
