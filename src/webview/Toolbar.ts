import { Store, displayAddr } from './state';
import { el, clear } from './dom';
import { post } from './vscodeApi';
import { parseNumericInput } from '../core/humanize';
import type { Endianness } from '../types/format';

export interface ToolbarCallbacks {
  onToggleSearch(): void;
  onGoto(offset: number): void;
}

export class Toolbar {
  private offsetReadout: HTMLElement;
  private formatSelectWrap: HTMLElement;
  private inspectorBtn: HTMLButtonElement;
  private rawBtn: HTMLButtonElement;
  private structBtn: HTMLButtonElement;
  private sectionsBtn: HTMLButtonElement;
  private gotoInput: HTMLInputElement;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private cb: ToolbarCallbacks,
  ) {
    this.root.classList.add('bv-toolbar');

    this.rawBtn = el('button', {
      class: 'bv-seg',
      text: 'Raw',
      onclick: () => this.setView('raw'),
    });
    this.structBtn = el('button', {
      class: 'bv-seg',
      text: 'Structure',
      onclick: () => this.setView('structure'),
    });
    this.sectionsBtn = el('button', {
      class: 'bv-seg',
      text: 'Sections',
      onclick: () => this.setView('sections'),
    });
    const segmented = el('div', { class: 'bv-segmented' }, [
      this.rawBtn,
      this.structBtn,
      this.sectionsBtn,
    ]);

    const bytesSelect = el('select', {
      class: 'bv-select',
      title: 'Bytes per row',
      onchange: (e) => {
        const v = Number((e.target as HTMLSelectElement).value) as 8 | 16 | 32;
        this.store.update({ bytesPerRow: v });
        this.persist();
      },
    }) as HTMLSelectElement;
    for (const n of [8, 16, 32]) {
      bytesSelect.append(el('option', { value: n, text: String(n) }));
    }
    bytesSelect.value = String(this.store.state.bytesPerRow);

    const endianSelect = el('select', {
      class: 'bv-select',
      title: 'Endianness (inspector + structure decode)',
      onchange: (e) => {
        const v = (e.target as HTMLSelectElement).value as Endianness;
        this.store.update({ endianness: v });
        this.persist();
        if (this.store.state.activeFormat) {
          post({ type: 'requestParse', formatName: this.store.state.activeFormat, endianness: this.store.state.endianness });
        }
      },
    }) as HTMLSelectElement;
    endianSelect.append(
      el('option', { value: 'little', text: 'Little Endian' }),
      el('option', { value: 'big', text: 'Big Endian' }),
    );
    endianSelect.value = this.store.state.endianness;

    this.formatSelectWrap = el('span', { class: 'bv-tool' });

    this.inspectorBtn = el('button', {
      class: 'bv-btn',
      text: 'Inspector',
      onclick: () => {
        this.store.update({ showInspector: !this.store.state.showInspector });
        this.persist();
      },
    });

    const searchBtn = el('button', { class: 'bv-btn', text: 'Search', onclick: () => this.cb.onToggleSearch() });

    this.gotoInput = el('input', {
      class: 'bv-input bv-goto-input',
      type: 'text',
      placeholder: '0x1000',
      hidden: true,
      onkeydown: (e) => {
        const ev = e as KeyboardEvent;
        if (ev.key === 'Enter') {
          const n = parseNumericInput(this.gotoInput.value);
          if (n !== undefined) {
            this.cb.onGoto(n);
            this.gotoInput.hidden = true;
            this.gotoInput.value = '';
          } else {
            this.gotoInput.classList.add('bv-invalid');
          }
        } else if (ev.key === 'Escape') {
          this.gotoInput.hidden = true;
        } else {
          this.gotoInput.classList.remove('bv-invalid');
        }
      },
    }) as HTMLInputElement;
    const gotoBtn = el('button', {
      class: 'bv-btn',
      text: 'Go To',
      onclick: () => {
        this.gotoInput.hidden = !this.gotoInput.hidden;
        if (!this.gotoInput.hidden) {
          this.gotoInput.focus();
        }
      },
    });

    this.offsetReadout = el('span', { class: 'bv-offset-readout bv-mono' });

    this.root.append(
      segmented,
      el('span', { class: 'bv-tool' }, [el('label', { class: 'bv-label', text: 'Bytes:' }), bytesSelect]),
      el('span', { class: 'bv-tool' }, [el('label', { class: 'bv-label', text: 'Endian:' }), endianSelect]),
      this.formatSelectWrap,
      el('span', { class: 'bv-spacer' }),
      this.inspectorBtn,
      searchBtn,
      gotoBtn,
      this.gotoInput,
      this.offsetReadout,
    );

    this.store.subscribe((_s, changed) => {
      if (changed.has('view')) {
        this.syncView();
      }
      if (changed.has('bytesPerRow')) {
        bytesSelect.value = String(this.store.state.bytesPerRow);
      }
      if (changed.has('endianness')) {
        endianSelect.value = this.store.state.endianness;
      }
      if (changed.has('showInspector')) {
        this.inspectorBtn.classList.toggle('bv-btn-active', this.store.state.showInspector);
      }
      if (
        changed.has('caret') ||
        changed.has('selection') ||
        changed.has('baseAddress') ||
        changed.has('formatBaseAddress')
      ) {
        this.syncOffset();
      }
      if (changed.has('formats') || changed.has('activeFormat') || changed.has('detectedFormat')) {
        this.renderFormatSelect();
      }
    });

    this.syncView();
    this.syncOffset();
    this.renderFormatSelect();
    this.inspectorBtn.classList.toggle('bv-btn-active', this.store.state.showInspector);
  }

  private setView(view: 'raw' | 'structure' | 'sections'): void {
    this.store.update({ view });
    this.persist();
    const s = this.store.state;
    const needsParse =
      (view === 'structure' || view === 'sections') &&
      s.activeFormat &&
      s.parsed.length === 0 &&
      s.sections.length === 0;
    if (needsParse) {
      post({ type: 'requestParse', formatName: s.activeFormat!, endianness: s.endianness });
    }
  }

  private syncView(): void {
    const v = this.store.state.view;
    this.rawBtn.classList.toggle('bv-seg-active', v === 'raw');
    this.structBtn.classList.toggle('bv-seg-active', v === 'structure');
    this.sectionsBtn.classList.toggle('bv-seg-active', v === 'sections');
  }

  private syncOffset(): void {
    const s = this.store.state;
    const parts = [displayAddr(s, s.caret)];
    if (s.selection.length > 1) {
      parts.push(`+${s.selection.length}`);
    }
    this.offsetReadout.textContent = parts.join('  ');
  }

  private renderFormatSelect(): void {
    clear(this.formatSelectWrap);
    const s = this.store.state;

    const reloadBtn = el('button', {
      class: 'bv-btn bv-btn-sm bv-btn-icon',
      title: 'Reload binary formats (rescan workspace + global JSON)',
      text: '↻',
      onclick: () => post({ type: 'reloadFormats' }),
    });

    if (s.formats.length === 0 && !s.activeFormat) {
      this.formatSelectWrap.append(reloadBtn);
      return;
    }
    const select = el('select', {
      class: 'bv-select',
      title: 'Structure format',
      onchange: (e) => {
        const val = (e.target as HTMLSelectElement).value;
        post({ type: 'setActiveFormat', formatName: val === '' ? null : val, endianness: this.store.state.endianness });
      },
    }) as HTMLSelectElement;
    select.append(el('option', { value: '', text: 'Format: (none)' }));
    for (const f of s.formats) {
      const src =
        f.source === 'workspace'
          ? ' [workspace]'
          : f.source === 'external'
            ? ' [external]'
            : f.source === 'builtin'
              ? ' [builtin]'
              : '';
      const tag = f.name === s.detectedFormat ? ' (detected)' : '';
      select.append(el('option', { value: f.name, text: `Format: ${f.name}${src}${tag}` }));
    }
    select.value = s.activeFormat ?? '';
    this.formatSelectWrap.append(el('label', { class: 'bv-label', text: 'Format:' }), select, reloadBtn);
  }

  private persist(): void {
    const s = this.store.state;
    post({
      type: 'persistState',
      state: {
        view: s.view,
        bytesPerRow: s.bytesPerRow,
        endianness: s.endianness,
        showInspector: s.showInspector,
        scrollTop: 0,
        activeFormat: s.activeFormat,
      },
    });
  }
}
