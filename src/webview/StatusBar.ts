import { Store } from './state';
import { DataProvider } from './DataProvider';
import { el } from './dom';
import { offsetHex, humanFileSize } from '../core/humanize';

export class StatusBar {
  private offsetEl: HTMLElement;
  private decEl: HTMLElement;
  private sizeEl: HTMLElement;
  private selEl: HTMLElement;
  private valEl: HTMLElement;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private data: DataProvider,
  ) {
    this.root.classList.add('bv-status');
    this.offsetEl = el('span', { class: 'bv-stat' });
    this.decEl = el('span', { class: 'bv-stat' });
    this.sizeEl = el('span', { class: 'bv-stat' });
    this.selEl = el('span', { class: 'bv-stat' });
    this.valEl = el('span', { class: 'bv-stat' });
    this.root.append(this.offsetEl, this.decEl, this.sizeEl, this.selEl, this.valEl);

    this.store.subscribe((_s, changed) => {
      if (changed.has('caret') || changed.has('selection') || changed.has('fileSize')) {
        this.render();
      }
    });
    this.data.onData(() => this.render());
    this.render();
  }

  render(): void {
    const s = this.store.state;
    this.offsetEl.textContent = `Offset: ${offsetHex(s.caret)}`;
    this.decEl.textContent = `Decimal: ${s.caret}`;
    this.sizeEl.textContent = `File Size: ${humanFileSize(s.fileSize)} (${s.fileSize.toLocaleString()} bytes)`;

    if (s.selection.length > 1) {
      this.selEl.textContent = `Selected: ${s.selection.length} bytes [${offsetHex(
        s.selection.start,
      )} .. ${offsetHex(s.selection.start + s.selection.length - 1)}]`;
    } else {
      this.selEl.textContent = 'Selected: 1 byte';
    }

    const { bytes, complete } = this.data.peek(s.caret, 1);
    if (complete && s.caret < s.fileSize) {
      const b = bytes[0];
      this.valEl.textContent = `Value: 0x${b.toString(16).toUpperCase().padStart(2, '0')} (${b}) '${
        b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
      }'`;
    } else {
      this.valEl.textContent = 'Value: --';
    }
  }
}
