import * as assert from 'assert';
import { VirtualGrid } from '../../src/webview/VirtualGrid';

describe('VirtualGrid', () => {
  it('keeps overscan above the viewport in scaled files', () => {
    const grid = new VirtualGrid(2_000_000, 20);
    const height = 400;
    const scroll = (grid.sizerHeight() - height) / 2;
    const win = grid.windowFor(scroll, height);
    assert.ok(win.layerTop < scroll);
    const logicalVisible = win.firstRow + (scroll - win.layerTop) / grid.rowHeight;
    assert.strictEqual(logicalVisible, (grid.totalRows - height / grid.rowHeight) / 2);
  });

  for (const height of [400, 413]) {
    it(`aligns the last row with the viewport bottom at height ${height}`, () => {
      const grid = new VirtualGrid(2_000_000, 20);
      const scroll = grid.sizerHeight() - height;
      const win = grid.windowFor(scroll, height);
      assert.strictEqual(win.firstRow + win.rowCount, grid.totalRows);
      const lastRowBottom = win.layerTop + win.rowCount * grid.rowHeight;
      assert.ok(Math.abs(lastRowBottom - scroll - height) < 0.001);
      assert.ok(grid.scrollTopForRow(grid.totalRows - 1, height) <= scroll);
    });
  }

  it('clips overscan without extending the scroll range near EOF', () => {
    const grid = new VirtualGrid(2_000_000, 20);
    const height = 400;
    for (const remaining of [1, 10, 100]) {
      const scroll = grid.sizerHeight() - height - remaining;
      const win = grid.windowFor(scroll, height);
      assert.ok(win.layerTop + win.layerHeight <= grid.sizerHeight());
      assert.ok(win.layerTop + win.layerHeight >= scroll + height);
    }
  });

  it('reveals interior rows in both scaled and ordinary files', () => {
    for (const total of [1000, 2_000_000]) {
      const grid = new VirtualGrid(total, 20);
      const row = Math.floor(total / 2);
      const scroll = grid.scrollTopForRow(row, 400);
      const win = grid.windowFor(scroll, 400);
      const screenTop = win.layerTop + (row - win.firstRow) * 20 - scroll;
      assert.ok(screenTop >= 0 && screenTop < 400);
    }
  });
});
