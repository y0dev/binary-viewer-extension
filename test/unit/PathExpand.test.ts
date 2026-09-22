import * as assert from 'assert';
import * as path from 'path';
import { expandConfiguredPath } from '../../src/formats/PathExpand';

const WS = path.resolve('/repo/examples/binaries');
const HOME = path.resolve('/home/dev');

describe('expandConfiguredPath', () => {
  it('leaves a plain absolute path unchanged (aside from normalization)', () => {
    const abs = path.resolve('/shared/formats');
    assert.strictEqual(expandConfiguredPath(abs, HOME, WS), abs);
  });

  it('expands ~ to the home directory', () => {
    assert.strictEqual(expandConfiguredPath('~', HOME, undefined), HOME);
    assert.strictEqual(
      expandConfiguredPath('~/formats', HOME, undefined),
      path.resolve(HOME, 'formats'),
    );
  });

  it('expands ${workspaceFolder}', () => {
    assert.strictEqual(
      expandConfiguredPath('${workspaceFolder}/formats', HOME, WS),
      path.resolve(WS, 'formats'),
    );
  });

  it('resolves "${workspaceFolder}/../shared" to a sibling of the workspace', () => {
    const result = expandConfiguredPath('${workspaceFolder}/../shared-formats', HOME, WS);
    assert.strictEqual(result, path.resolve(WS, '..', 'shared-formats'));
  });

  it('resolves "${workspaceFolder}/../../x" up two levels (the reported bug)', () => {
    const result = expandConfiguredPath('${workspaceFolder}/../../.testing_results', HOME, WS);
    assert.strictEqual(result, path.resolve(WS, '..', '..', '.testing_results'));
  });

  it('leaves an actual URI scheme alone (no path resolution)', () => {
    assert.strictEqual(
      expandConfiguredPath('vscode-vfs://github/owner/repo/formats', HOME, WS),
      'vscode-vfs://github/owner/repo/formats',
    );
  });

  it('returns "" for blank/whitespace-only input without touching workspaceFolder/home', () => {
    assert.strictEqual(expandConfiguredPath('   ', HOME, WS), '');
  });

  it('leaves ${workspaceFolder} substitution as a no-op text when there is no workspace', () => {
    // No workspaceFsPath supplied — the literal placeholder stays, then gets
    // path-resolved as an ordinary (if nonsensical) relative path segment.
    const result = expandConfiguredPath('${workspaceFolder}/formats', HOME, undefined);
    assert.strictEqual(result, path.resolve('${workspaceFolder}/formats'));
  });
});
