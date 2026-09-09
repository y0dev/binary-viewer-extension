import { Store, displayAddr } from './state';
import { DataProvider } from './DataProvider';
import { VirtualGrid } from './VirtualGrid';

const HEX_LUT: string[] = [];
for (let i = 0; i < 256; i++) {
  HEX_LUT.push(i.toString(16).toUpperCase().padStart(2, '0'));
}

function asciiHtml(b: number): string {
  if (b === 0x20) {
    return '&nbsp;';
  }
  if (b < 0x20 || b > 0x7e) {
    return '.';
  }
  if (b === 0x26) {
    return '&amp;';
  }
  if (b === 0x3c) {
    return '&lt;';
  }
  if (b === 0x3e) {
    return '&gt;';
  }
  return String.fromCharCode(b);
}

export interface HexViewCallbacks {
  onSelectionChange(): void;
}

export class HexView {
  private scroller: HTMLDivElement;
  private sizer: HTMLDivElement;
  private layer: HTMLDivElement;
  private header: HTMLDivElement;
  private headerInner: HTMLDivElement;
  private grid: VirtualGrid;
  private rowHeight = 18;
  private dragging = false;
  private rafPending = false;
  private lastWindowKey = '';
  private measured = false;
  private forceNext = false;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private data: DataProvider,
    private cb: HexViewCallbacks,
  ) {
    this.root.classList.add('bv-hex');
    this.header = document.createElement('div');
    this.header.className = 'bv-hex-header';
    this.headerInner = document.createElement('div');
    this.headerInner.className = 'bv-hex-header-inner';
    this.header.append(this.headerInner);
    this.scroller = document.createElement('div');
    this.scroller.className = 'bv-hex-scroller';
    this.scroller.tabIndex = 0;
    this.sizer = document.createElement('div');
    this.sizer.className = 'bv-hex-sizer';
    this.layer = document.createElement('div');
    this.layer.className = 'bv-hex-layer';
    this.scroller.append(this.sizer, this.layer);
    this.root.append(this.header, this.scroller);

    const rows = () => Math.ceil(this.store.state.fileSize / this.store.state.bytesPerRow) || 1;
    this.grid = new VirtualGrid(rows(), this.rowHeight);

    this.scroller.addEventListener('scroll', () => {
      this.headerInner.style.transform = `translateX(${-this.scroller.scrollLeft}px)`;
      this.scheduleRender();
    });
    window.addEventListener('resize', () => this.layout());

    this.layer.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.layer.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => (this.dragging = false));
    this.scroller.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.data.onData(() => this.scheduleRender(true));
    this.store.subscribe((_s, changed) => {
      if (changed.has('bytesPerRow')) {
        this.grid.totalRows = rows();
        this.render(true);
      } else if (
        changed.has('selection') ||
        changed.has('caret') ||
        changed.has('activeNodeId') ||
        changed.has('baseAddress') ||
        changed.has('formatBaseAddress')
      ) {
        this.render(true);
      }
    });
  }

  // ---- lifecycle ----------------------------------------------------

  layout(): void {
    this.measureRow();
    this.grid.totalRows = Math.ceil(this.store.state.fileSize / this.store.state.bytesPerRow) || 1;
    this.grid.rowHeight = this.rowHeight;
    this.sizer.style.height = `${this.grid.sizerHeight()}px`;
    this.render(true);
  }

  focus(): void {
    this.scroller.focus();
  }

  private measureRow(): void {
    if (this.measured) {
      return;
    }
    const probe = document.createElement('div');
    probe.className = 'bv-row';
    probe.innerHTML = '<span class="bv-off">00000000</span><span class="bv-cell">00</span>';
    probe.style.visibility = 'hidden';
    this.layer.append(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    if (h > 4) {
      this.rowHeight = Math.round(h);
      this.grid.rowHeight = this.rowHeight;
      this.measured = true;
    }
  }

  // ---- rendering --------------------------------------------------

  private scheduleRender(force = false): void {
    if (force) {
      this.forceNext = true;
    }
    if (this.rafPending) {
      return;
    }
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      const f = this.forceNext;
      this.forceNext = false;
      this.render(f);
    });
  }

  private render(force: boolean): void {
    const vh = this.scroller.clientHeight || this.root.clientHeight || 600;
    if (vh === 0) {
      return;
    }
    this.measureRow();
    this.sizer.style.height = `${this.grid.sizerHeight()}px`;
    const win = this.grid.windowFor(this.scroller.scrollTop, vh);
    const bpr = this.store.state.bytesPerRow;
    const base = this.store.state.formatBaseAddress ?? this.store.state.baseAddress;
    const key = `${win.firstRow}:${win.rowCount}:${bpr}:${this.store.state.selection.start}:${this.store.state.selection.length}:${this.store.state.caret}:${this.store.state.activeNodeId}:${base}`;
    if (!force && key === this.lastWindowKey) {
      return;
    }
    this.lastWindowKey = key;

    const startOffset = win.firstRow * bpr;
    const spanLen = win.rowCount * bpr;
    const { bytes, complete } = this.data.peek(startOffset, spanLen);
    if (!complete) {
      void this.data.prefetch(startOffset, spanLen);
    }
    // Prefetch neighbours for smoother scrolling.
    void this.data.prefetch(Math.max(0, startOffset - spanLen), spanLen);
    void this.data.prefetch(startOffset + spanLen, spanLen);

    this.renderHeader(bpr);

    const sel = this.store.state.selection;
    const selEnd = sel.start + sel.length;
    const caret = this.store.state.caret;
    const fileSize = this.store.state.fileSize;
    const rowH = this.rowHeight;

    let html = '';
    for (let r = 0; r < win.rowCount; r++) {
      const rowOffset = (win.firstRow + r) * bpr;
      if (rowOffset >= fileSize) {
        break;
      }
      html += `<div class="bv-row" style="height:${rowH}px">`;
      html += `<span class="bv-off">${displayAddr(this.store.state, rowOffset).slice(2)}</span>`;
      html += '<span class="bv-hexcells">';
      for (let c = 0; c < bpr; c++) {
        const o = rowOffset + c;
        const split = c > 0 && c % 8 === 0 ? ' bv-split' : '';
        if (o >= fileSize) {
          html += `<span class="bv-cell bv-cell-empty${split}">&nbsp;&nbsp;</span>`;
          continue;
        }
        const b = bytes[o - startOffset] ?? 0;
        const cls = this.cellClass(o, sel.start, selEnd, caret);
        html += `<span class="bv-cell${split}${cls}" data-o="${o}">${HEX_LUT[b]}</span>`;
      }
      html += '</span><span class="bv-asc-sep"></span><span class="bv-ascii">';
      for (let c = 0; c < bpr; c++) {
        const o = rowOffset + c;
        if (o >= fileSize) {
          html += '<span class="bv-ac bv-cell-empty">&nbsp;</span>';
          continue;
        }
        const b = bytes[o - startOffset] ?? 0;
        const cls = this.cellClass(o, sel.start, selEnd, caret);
        html += `<span class="bv-ac${cls}" data-o="${o}">${asciiHtml(b)}</span>`;
      }
      html += '</span></div>';
    }

    this.layer.style.transform = `translateY(${win.layerTop}px)`;
    this.layer.innerHTML = html;
  }

  private cellClass(o: number, selStart: number, selEnd: number, caret: number): string {
    let cls = '';
    if (selEnd > selStart && o >= selStart && o < selEnd) {
      cls += ' bv-selected';
    }
    if (o === caret) {
      cls += ' bv-caret';
    }
    return cls;
  }

  private renderHeader(bpr: number): void {
    const key = `h${bpr}`;
    if (this.headerInner.dataset.key === key) {
      return;
    }
    this.headerInner.dataset.key = key;
    let html = '<span class="bv-off">Offset</span><span class="bv-hexcells">';
    for (let c = 0; c < bpr; c++) {
      const split = c > 0 && c % 8 === 0 ? ' bv-split' : '';
      html += `<span class="bv-cell bv-colhead${split}">${c.toString(16).toUpperCase().padStart(2, '0')}</span>`;
    }
    html += '</span><span class="bv-asc-sep"></span><span class="bv-ascii bv-colhead">ASCII</span>';
    this.headerInner.innerHTML = html;
  }

  // ---- interaction ----------------------------------------------

  private offsetFromEvent(e: MouseEvent): number | null {
    const target = (e.target as HTMLElement).closest('[data-o]') as HTMLElement | null;
    if (!target) {
      return null;
    }
    const o = Number(target.dataset.o);
    return Number.isFinite(o) ? o : null;
  }

  private onMouseDown(e: MouseEvent): void {
    const o = this.offsetFromEvent(e);
    if (o === null) {
      return;
    }
    e.preventDefault();
    this.scroller.focus();
    if (e.shiftKey) {
      this.extendTo(o);
    } else {
      this.store.update({ anchor: o, caret: o, selection: { start: o, length: 1 }, activeNodeId: null });
      this.dragging = true;
    }
    this.cb.onSelectionChange();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.dragging) {
      return;
    }
    const o = this.offsetFromEvent(e);
    if (o === null) {
      return;
    }
    this.extendTo(o);
    this.cb.onSelectionChange();
  }

  private extendTo(o: number): void {
    const anchor = this.store.state.anchor;
    const start = Math.min(anchor, o);
    const end = Math.max(anchor, o);
    this.store.update({
      caret: o,
      selection: { start, length: end - start + 1 },
      activeNodeId: null,
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    const bpr = this.store.state.bytesPerRow;
    const vh = this.scroller.clientHeight || 600;
    const pageRows = Math.max(1, Math.floor(vh / this.rowHeight) - 1);
    const last = Math.max(0, this.store.state.fileSize - 1);
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        target = this.store.state.caret - 1;
        break;
      case 'ArrowRight':
        target = this.store.state.caret + 1;
        break;
      case 'ArrowUp':
        target = this.store.state.caret - bpr;
        break;
      case 'ArrowDown':
        target = this.store.state.caret + bpr;
        break;
      case 'PageUp':
        target = this.store.state.caret - pageRows * bpr;
        break;
      case 'PageDown':
        target = this.store.state.caret + pageRows * bpr;
        break;
      case 'Home':
        target = e.ctrlKey || e.metaKey ? 0 : this.store.state.caret - (this.store.state.caret % bpr);
        break;
      case 'End':
        target = e.ctrlKey || e.metaKey
          ? last
          : this.store.state.caret - (this.store.state.caret % bpr) + bpr - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    target = Math.max(0, Math.min(target, last));
    if (e.shiftKey) {
      this.extendTo(target);
    } else {
      this.store.update({
        anchor: target,
        caret: target,
        selection: { start: target, length: 1 },
        activeNodeId: null,
      });
    }
    this.revealOffset(target);
    this.cb.onSelectionChange();
  }

  revealOffset(offset: number): void {
    const bpr = this.store.state.bytesPerRow;
    const row = Math.floor(offset / bpr);
    const vh = this.scroller.clientHeight || 600;
    const rowTop = this.grid.scaled ? null : row * this.rowHeight;
    const curTop = this.scroller.scrollTop;
    if (rowTop === null) {
      this.scroller.scrollTop = this.grid.scrollTopForRow(row, vh);
    } else if (rowTop < curTop || rowTop + this.rowHeight > curTop + vh) {
      this.scroller.scrollTop = this.grid.scrollTopForRow(row, vh);
    }
    this.scheduleRender();
  }

  get scrollTop(): number {
    return this.scroller.scrollTop;
  }
}
