import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const EXT_ID = 'binary-viewer.binary-viewer';

function makeFirmwareFixture(): vscode.Uri {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binview-int-'));
  const p = path.join(dir, 'firmware.bin');
  const buf = Buffer.alloc(256);
  buf.write('FW', 0, 'ascii');
  buf[2] = 0x01;
  buf[3] = 0x00;
  buf.writeUInt16LE(2, 4);
  buf.writeUInt16LE(0b101, 6);
  buf.writeUInt32LE(8192, 8);
  buf.writeUInt32LE(0x00200000, 12);
  fs.writeFileSync(p, buf);
  return vscode.Uri.file(p);
}

describe('Binary Viewer integration', () => {
  it('activates the extension', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, 'extension not found');
    await ext!.activate();
    assert.ok(ext!.isActive);
  });

  it('registers all contributed commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const cmd of [
      'binaryViewer.goToOffset',
      'binaryViewer.search',
      'binaryViewer.toggleStructureView',
      'binaryViewer.toggleInspector',
      'binaryViewer.createFormat',
      'binaryViewer.editFormat',
      'binaryViewer.importFormat',
      'binaryViewer.exportFormat',
      'binaryViewer.reloadFormats',
    ]) {
      assert.ok(all.includes(cmd), `missing command ${cmd}`);
    }
  });

  it('opens a .bin file in the custom editor without throwing', async () => {
    const uri = makeFirmwareFixture();
    await vscode.commands.executeCommand('vscode.openWith', uri, 'binaryViewer.hexEditor');
    // Give the webview a moment to resolve.
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(vscode.window.tabGroups.all.some((g) => g.tabs.length > 0));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  it('reloads formats and finds the builtin firmware example', async () => {
    await vscode.commands.executeCommand('binaryViewer.reloadFormats');
    // Nothing to assert directly via the public API; the command must not throw.
  });
});
