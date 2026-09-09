/**
 * Maps a very large logical row count onto a scrollable area whose pixel height
 * stays within the browser's element-height limit. For files small enough that
 * `totalRows * rowHeight` fits, this is an identity mapping.
 */
const MAX_SCROLL_PX = 30_000_000;

export interface GridWindow {
  firstRow: number;
  rowCount: number;
  /** translateY to apply to the rendered rows layer. */
  layerTop: number;
}

export class VirtualGrid {
  constructor(
    public totalRows: number,
    public rowHeight: number,
    public overscan = 8,
  ) {}

  get scaled(): boolean {
    return this.totalRows * this.rowHeight > MAX_SCROLL_PX;
  }

  /** Height of the inner sizer element. */
  sizerHeight(): number {
    return this.scaled ? MAX_SCROLL_PX : this.totalRows * this.rowHeight;
  }

  /** Which rows to render for a given scroll position + viewport height. */
  windowFor(scrollTop: number, viewportHeight: number): GridWindow {
    const visibleRows = Math.ceil(viewportHeight / this.rowHeight) + 1;
    if (!this.scaled) {
      const firstRow = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.overscan);
      const rowCount = Math.min(this.totalRows - firstRow, visibleRows + this.overscan * 2);
      return { firstRow, rowCount: Math.max(0, rowCount), layerTop: firstRow * this.rowHeight };
    }
    const maxScroll = Math.max(1, this.sizerHeight() - viewportHeight);
    const maxFirstRow = Math.max(0, this.totalRows - visibleRows);
    const ratio = Math.min(1, Math.max(0, scrollTop / maxScroll));
    const firstRow = Math.max(0, Math.round(ratio * maxFirstRow) - this.overscan);
    const rowCount = Math.min(this.totalRows - firstRow, visibleRows + this.overscan * 2);
    return { firstRow: Math.max(0, firstRow), rowCount: Math.max(0, rowCount), layerTop: scrollTop };
  }

  /** Inverse: scrollTop that brings `row` into view (near the top third). */
  scrollTopForRow(row: number, viewportHeight: number): number {
    if (!this.scaled) {
      return Math.max(0, row * this.rowHeight - viewportHeight / 3);
    }
    const visibleRows = Math.ceil(viewportHeight / this.rowHeight) + 1;
    const maxFirstRow = Math.max(1, this.totalRows - visibleRows);
    const maxScroll = Math.max(1, this.sizerHeight() - viewportHeight);
    const targetFirst = Math.max(0, row - Math.floor(visibleRows / 3));
    return (targetFirst / maxFirstRow) * maxScroll;
  }
}
