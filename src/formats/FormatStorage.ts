import * as vscode from 'vscode';
import * as os from 'os';
import type { FormatDefinition, FormatSource, LoadedFormat } from '../types/format';
import { validateFormat } from '../core/FormatSchema';
import { log } from '../util/logger';

const WORKSPACE_REL = '.vscode/binary-viewer/formats';

/** Expand `~` and `${workspaceFolder}` in a user-configured directory path. */
export function expandDirPath(input: string): string {
  let p = input.trim();
  if (p === '') {
    return p;
  }
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = os.homedir() + p.slice(1);
  }
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (ws) {
    p = p.replace(/\$\{workspaceFolder\}/g, ws);
  }
  return p;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'format'
  );
}

async function readJsonDir(
  dir: vscode.Uri,
  source: Exclude<FormatSource, 'builtin'>,
): Promise<LoadedFormat[]> {
  const out: LoadedFormat[] = [];
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return out;
  }
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !name.toLowerCase().endsWith('.json')) {
      continue;
    }
    const uri = vscode.Uri.joinPath(dir, name);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        const result = validateFormat(item);
        if (result.valid) {
          out.push({ definition: item as FormatDefinition, source, uri: uri.toString() });
        } else {
          log().warn(`Ignoring invalid format in ${uri.fsPath}: ${result.errors.join('; ')}`);
        }
      }
    } catch (e) {
      log().warn(`Failed to read format ${uri.fsPath}: ${(e as Error).message}`);
    }
  }
  return out;
}

export class FormatStorage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get globalDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'formats');
  }

  workspaceDirs(): vscode.Uri[] {
    if (!vscode.workspace.isTrusted) {
      return [];
    }
    return (vscode.workspace.workspaceFolders ?? []).map((f) =>
      vscode.Uri.joinPath(f.uri, ...WORKSPACE_REL.split('/')),
    );
  }

  /** Extra folders from the `binaryViewer.formatDirectories` setting. */
  externalDirs(): vscode.Uri[] {
    const raw = vscode.workspace
      .getConfiguration('binaryViewer')
      .get<string[]>('formatDirectories', []);
    if (!Array.isArray(raw)) {
      return [];
    }
    const seen = new Set<string>();
    const out: vscode.Uri[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        continue;
      }
      const expanded = expandDirPath(entry);
      let uri: vscode.Uri;
      try {
        uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(expanded)
          ? vscode.Uri.parse(expanded)
          : vscode.Uri.file(expanded);
      } catch {
        log().warn(`Ignoring invalid binaryViewer.formatDirectories entry: ${entry}`);
        continue;
      }
      const key = uri.toString();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(uri);
      }
    }
    return out;
  }

  /** Glob patterns to watch for created / changed / deleted format files. */
  allWatchableGlobs(): vscode.RelativePattern[] {
    const globs: vscode.RelativePattern[] = [
      // Global storage (non-recursive watcher on direct *.json children).
      new vscode.RelativePattern(this.globalDir, '*.json'),
    ];
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      globs.push(new vscode.RelativePattern(f, `${WORKSPACE_REL}/*.json`));
    }
    for (const dir of this.externalDirs()) {
      globs.push(new vscode.RelativePattern(dir, '*.json'));
    }
    return globs;
  }

  async ensureGlobalDir(): Promise<void> {
    await this.ensureDir(this.globalDir);
  }

  async loadGlobal(): Promise<LoadedFormat[]> {
    return readJsonDir(this.globalDir, 'global');
  }

  async loadWorkspace(): Promise<LoadedFormat[]> {
    const all: LoadedFormat[] = [];
    for (const dir of this.workspaceDirs()) {
      all.push(...(await readJsonDir(dir, 'workspace')));
    }
    return all;
  }

  async loadExternal(): Promise<LoadedFormat[]> {
    const all: LoadedFormat[] = [];
    for (const dir of this.externalDirs()) {
      all.push(...(await readJsonDir(dir, 'external')));
    }
    return all;
  }

  private async ensureDir(dir: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(dir);
    } catch {
      /* already exists */
    }
  }

  /** Persist a format to a JSON file. Returns the file uri. */
  async saveGlobal(def: FormatDefinition, previousName?: string): Promise<vscode.Uri> {
    const result = validateFormat(def);
    if (!result.valid) {
      throw new Error(`Cannot save invalid format:\n${result.errors.join('\n')}`);
    }
    await this.ensureDir(this.globalDir);
    if (previousName && previousName !== def.name) {
      await this.deleteGlobal(previousName).catch(() => undefined);
    }
    const uri = vscode.Uri.joinPath(this.globalDir, `${slugify(def.name)}.json`);
    const json = JSON.stringify(def, null, 2);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(json + '\n'));
    return uri;
  }

  async saveWorkspace(def: FormatDefinition, folder: vscode.WorkspaceFolder): Promise<vscode.Uri> {
    const result = validateFormat(def);
    if (!result.valid) {
      throw new Error(`Cannot save invalid format:\n${result.errors.join('\n')}`);
    }
    const dir = vscode.Uri.joinPath(folder.uri, ...WORKSPACE_REL.split('/'));
    await this.ensureDir(dir);
    const uri = vscode.Uri.joinPath(dir, `${slugify(def.name)}.json`);
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(JSON.stringify(def, null, 2) + '\n'),
    );
    return uri;
  }

  async deleteGlobal(name: string): Promise<void> {
    const uri = vscode.Uri.joinPath(this.globalDir, `${slugify(name)}.json`);
    await vscode.workspace.fs.delete(uri);
  }

  async importFromFile(source: vscode.Uri): Promise<FormatDefinition[]> {
    const bytes = await vscode.workspace.fs.readFile(source);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const imported: FormatDefinition[] = [];
    for (const item of list) {
      const result = validateFormat(item);
      if (!result.valid) {
        throw new Error(`Invalid format definition:\n${result.errors.join('\n')}`);
      }
      await this.saveGlobal(item as FormatDefinition);
      imported.push(item as FormatDefinition);
    }
    return imported;
  }

  async exportToFile(defs: FormatDefinition[], target: vscode.Uri): Promise<void> {
    const payload = defs.length === 1 ? defs[0] : defs;
    await vscode.workspace.fs.writeFile(
      target,
      new TextEncoder().encode(JSON.stringify(payload, null, 2) + '\n'),
    );
  }
}
