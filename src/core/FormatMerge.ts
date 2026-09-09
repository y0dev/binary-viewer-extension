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

function isDirectChild(fsPath: string, dir: string): boolean {
  const d = dir.toLowerCase().replace(/[/\\]+$/, '');
  const p = fsPath.toLowerCase();
  if (!p.startsWith(d + '/') && !p.startsWith(d + '\\')) {
    return false;
  }
  const rest = p.slice(d.length + 1);
  return rest.length > 0 && !rest.includes('/') && !rest.includes('\\');
}

/**
 * True when `fsPath` is a format-definition JSON file — the workspace folder
 * `.vscode/binary-viewer/formats/`, directly inside the global storage folder
 * (named `<publisher>.<extension>`), or directly inside one of `extraDirs`
 * (the `binaryViewer.formatDirectories` setting).
 */
export function isFormatFilePath(
  fsPath: string,
  globalFormatsDir: string,
  extraDirs: string[] = [],
): boolean {
  if (!fsPath.toLowerCase().endsWith('.json')) {
    return false;
  }
  if (WORKSPACE_FORMAT_RE.test(fsPath)) {
    return true;
  }
  if (isDirectChild(fsPath, globalFormatsDir)) {
    return true;
  }
  return extraDirs.some((d) => isDirectChild(fsPath, d));
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
