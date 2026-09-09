/**
 * Precedence resolution for loaded format definitions. Pure (no vscode / no I/O)
 * so it can be unit-tested directly.
 *
 * Groups are merged lowest-priority first (builtin -> global -> workspace). An
 * incoming definition displaces any already-merged one it collides with **by
 * format name OR by backing-file name** — so a workspace `firmware.json`
 * shadows the global `firmware.json` even when the two `name` fields differ.
 */

import type { LoadedFormat } from '../types/format';

/** The workspace formats folder: `<repo>/.vscode/binary-viewer/formats/*.json`. */
const WORKSPACE_FORMAT_RE = /[/\\]\.vscode[/\\]binary-viewer[/\\]formats[/\\][^/\\]+\.json$/i;

/**
 * True when `fsPath` is a format-definition JSON file — either the workspace
 * folder above, or directly inside `globalFormatsDir` (whose name is
 * `<publisher>.<extension>`, so it needs an explicit prefix check).
 */
export function isFormatFilePath(fsPath: string, globalFormatsDir: string): boolean {
  if (!fsPath.toLowerCase().endsWith('.json')) {
    return false;
  }
  if (WORKSPACE_FORMAT_RE.test(fsPath)) {
    return true;
  }
  const dir = globalFormatsDir.toLowerCase().replace(/[/\\]+$/, '');
  const p = fsPath.toLowerCase();
  return p.startsWith(dir + '/') || p.startsWith(dir + '\\');
}

/** Lowercase file basename (without `.json`) of a uri string, or undefined. */
export function formatFileKey(uriString: string | undefined): string | undefined {
  if (!uriString) {
    return undefined;
  }
  const noHashQuery = uriString.split('#')[0].split('?')[0];
  const slash = noHashQuery.lastIndexOf('/');
  let base = slash >= 0 ? noHashQuery.slice(slash + 1) : noHashQuery;
  try {
    base = decodeURIComponent(base);
  } catch {
    /* keep raw */
  }
  base = base.replace(/\.json$/i, '').toLowerCase();
  return base || undefined;
}

/** Merge groups in ascending priority order; later groups win collisions. */
export function mergeFormats(groupsLowToHigh: LoadedFormat[][]): LoadedFormat[] {
  const merged: LoadedFormat[] = [];
  const add = (f: LoadedFormat) => {
    const fileKey = formatFileKey(f.uri);
    const idx = merged.findIndex(
      (m) =>
        m.definition.name === f.definition.name ||
        (fileKey !== undefined && formatFileKey(m.uri) === fileKey),
    );
    if (idx >= 0) {
      merged[idx] = f;
    } else {
      merged.push(f);
    }
  };
  for (const group of groupsLowToHigh) {
    for (const f of group) {
      add(f);
    }
  }
  return merged;
}
