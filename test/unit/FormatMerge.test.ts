import * as assert from 'assert';
import { formatFileKey, mergeFormats, isFormatFilePath } from '../../src/core/FormatMerge';
import type { LoadedFormat } from '../../src/types/format';

function lf(
  name: string,
  source: LoadedFormat['source'],
  file?: string,
): LoadedFormat {
  return {
    definition: { name, fields: [{ name: 'x', type: 'uint8', offset: 0 }] },
    source,
    uri: file ? `file:///w/${file}` : undefined,
  };
}

describe('FormatMerge.formatFileKey', () => {
  it('extracts the lowercase basename without .json', () => {
    assert.strictEqual(formatFileKey('file:///c:/x/Firmware.JSON'), 'firmware');
    assert.strictEqual(formatFileKey('file:///w/.vscode/binary-viewer/formats/eeprom.json'), 'eeprom');
    assert.strictEqual(formatFileKey('file:///w/my%20format.json'), 'my format');
    assert.strictEqual(formatFileKey(undefined), undefined);
  });
});

describe('FormatMerge.isFormatFilePath', () => {
  const g = 'C:\\Users\\me\\AppData\\Roaming\\Code\\User\\globalStorage\\devdoesit.binary-structure-inspector\\formats';

  it('accepts the workspace .vscode/binary-viewer/formats path', () => {
    assert.ok(isFormatFilePath('/home/u/proj/.vscode/binary-viewer/formats/fw.json', g));
    assert.ok(isFormatFilePath('C:\\proj\\.vscode\\binary-viewer\\formats\\Fw.JSON', g));
  });

  it('accepts files directly inside the global storage formats folder', () => {
    assert.ok(isFormatFilePath(g + '\\firmware.json', g));
    assert.ok(isFormatFilePath(g + '/firmware.json', g));
  });

  it('rejects unrelated JSON and nested paths', () => {
    assert.ok(!isFormatFilePath('/home/u/proj/package.json', g));
    assert.ok(!isFormatFilePath('/home/u/proj/.vscode/settings.json', g));
    assert.ok(!isFormatFilePath('/home/u/proj/.vscode/binary-viewer/formats/sub/x.json', g));
    assert.ok(!isFormatFilePath(g + '\\firmware.txt', g));
    assert.ok(!isFormatFilePath(g + 'X\\firmware.json', g)); // sibling dir, not the formats dir
    assert.ok(!isFormatFilePath(g + '\\sub\\firmware.json', g)); // nested, not a direct child
  });

  it('accepts a file directly inside a configured formatDirectories folder', () => {
    const extra = ['\\\\team-nas\\share\\binviewer', '/mnt/shared/formats'];
    assert.ok(isFormatFilePath('\\\\team-nas\\share\\binviewer\\fw.json', g, extra));
    assert.ok(isFormatFilePath('/mnt/shared/formats/eeprom.json', g, extra));
    assert.ok(!isFormatFilePath('/mnt/shared/formats/nested/x.json', g, extra));
    assert.ok(!isFormatFilePath('/mnt/other/x.json', g, extra));
  });
});

describe('FormatMerge.mergeFormats — workspace (local) wins', () => {
  it('overrides a global format with the same format name', () => {
    const builtin = [lf('ELF Header', 'builtin')];
    const global = [lf('Firmware', 'global', 'firmware.json')];
    const workspace = [lf('Firmware', 'workspace', 'fw-custom.json')];
    const merged = mergeFormats([builtin, global, workspace]);
    assert.strictEqual(merged.length, 2);
    const fw = merged.find((m) => m.definition.name === 'Firmware')!;
    assert.strictEqual(fw.source, 'workspace');
  });

  it('overrides a global format with the same JSON file name even if the format name differs', () => {
    const global = [lf('Firmware Image', 'global', 'firmware.json')];
    const workspace = [lf('ACME Firmware', 'workspace', 'firmware.json')];
    const merged = mergeFormats([[], global, workspace]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].source, 'workspace');
    assert.strictEqual(merged[0].definition.name, 'ACME Firmware');
  });

  it('keeps unrelated formats from every source', () => {
    const merged = mergeFormats([
      [lf('BMP', 'builtin')],
      [lf('Firmware', 'global', 'firmware.json'), lf('EEPROM', 'global', 'eeprom.json')],
      [lf('Packet', 'workspace', 'packet.json')],
    ]);
    assert.deepStrictEqual(
      merged.map((m) => m.definition.name).sort(),
      ['BMP', 'EEPROM', 'Firmware', 'Packet'],
    );
  });

  it('later group always wins on a name collision (workspace > global > builtin)', () => {
    const merged = mergeFormats([
      [lf('X', 'builtin')],
      [lf('X', 'global', 'x.json')],
      [lf('X', 'workspace', 'x2.json')],
    ]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].source, 'workspace');
  });

  it('a builtin (no file) only collides by name', () => {
    const merged = mergeFormats([
      [lf('Firmware', 'builtin')],
      [lf('Firmware', 'global', 'firmware.json')],
    ]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].source, 'global');
  });
});
