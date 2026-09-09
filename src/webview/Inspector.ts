import { Store } from './state';
import { DataProvider } from './DataProvider';
import { el, clear } from './dom';
import { offsetHex } from '../core/humanize';
import { describeByte, interpretScalars, Interp } from './inspectorMath';

export class Inspector {
  private body: HTMLDivElement;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private data: DataProvider,
  ) {
    this.root.classList.add('bv-inspector');
    this.root.append(el('div', { class: 'bv-inspector-title', text: 'Data Inspector' }));
    this.body = el('div', { class: 'bv-inspector-body' });
    this.root.append(this.body);

    this.data.onData(() => this.render());
    this.store.subscribe((_s, changed) => {
      if (
        changed.has('caret') ||
        changed.has('selection') ||
        changed.has('endianness') ||
        changed.has('showInspector')
      ) {
        this.render();
      }
    });
    this.render();
  }

  render(): void {
    const s = this.store.state;
    this.root.hidden = !s.showInspector;
    if (!s.showInspector) {
      return;
    }
    clear(this.body);

    const caret = s.caret;
    const fileSize = s.fileSize;
    const le = s.endianness === 'little';

    // ---- Selected byte ----
    const byteWin = this.data.peek(caret, 8);
    if (!byteWin.complete) {
      void this.data.prefetch(caret, 8);
    }
    const availByte = Math.max(0, Math.min(8, fileSize - caret));

    this.body.append(
      this.section('Selected Byte', [
        row('Offset', `${offsetHex(caret)}`),
        row('Decimal', `${caret}`),
        ...(availByte >= 1 ? describeByte(byteWin.bytes[0]).map((i) => row(i.label, i.value)) : [row('', '(end of file)')]),
      ]),
    );

    // ---- Scalars at caret (current endianness) ----
    this.body.append(
      this.section(
        `Interpret at caret (${le ? 'Little' : 'Big'} Endian)`,
        interpretScalars(byteWin.bytes, le, availByte).map((i) => scalarRow(i)),
      ),
    );

    // ---- Selection range ----
    if (s.selection.length > 1) {
      const selStart = s.selection.start;
      const selLen = s.selection.length;
      const rangeWin = this.data.peek(selStart, Math.min(selLen, 64));
      if (!rangeWin.complete) {
        void this.data.prefetch(selStart, Math.min(selLen, 64));
      }
      const availRange = Math.max(0, Math.min(8, fileSize - selStart));
      const hexDump = Array.from(rangeWin.bytes.subarray(0, 32), (b) =>
        b.toString(16).toUpperCase().padStart(2, '0'),
      ).join(' ');

      this.body.append(
        this.section('Selected Range', [
          row('Offset', offsetHex(selStart)),
          row('Length', `${selLen} bytes`),
          row('End', offsetHex(selStart + selLen)),
          row('Hex', hexDump + (selLen > 32 ? ' ...' : '')),
        ]),
      );
      this.body.append(
        this.section(
          'Little Endian',
          interpretScalars(rangeWin.bytes, true, availRange).map((i) => scalarRow(i)),
        ),
      );
      this.body.append(
        this.section(
          'Big Endian',
          interpretScalars(rangeWin.bytes, false, availRange).map((i) => scalarRow(i)),
        ),
      );
    }
  }

  private section(title: string, rows: HTMLElement[]): HTMLElement {
    return el('div', { class: 'bv-insp-section' }, [
      el('div', { class: 'bv-insp-head', text: title }),
      el('div', { class: 'bv-insp-rows' }, rows),
    ]);
  }
}

function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'bv-insp-row' }, [
    el('span', { class: 'bv-insp-k', text: label }),
    el('span', { class: 'bv-insp-v', text: value }),
  ]);
}

function scalarRow(i: Interp): HTMLElement {
  return el('div', { class: 'bv-insp-row' + (i.missing ? ' bv-insp-missing' : '') }, [
    el('span', { class: 'bv-insp-k', text: i.label }),
    el('span', { class: 'bv-insp-v', text: i.missing ? '--' : i.value }),
  ]);
}
