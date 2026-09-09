import { Store, selectBytes, displayAddr } from './state';
import { el, clear } from './dom';
import { post } from './vscodeApi';
import { humanFileSize } from '../core/humanize';
import { hasFlagsColumn, hasDisplayColumn } from '../core/Sections';
import type { ParsedSection } from '../types/messages';

export interface SectionsCallbacks {
  onRevealSection(start: number, length: number): void;
}

export class SectionsView {
  private toolbar: HTMLDivElement;
  private tableWrap: HTMLDivElement;
  private hideHidden = false;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private cb: SectionsCallbacks,
  ) {
    this.root.classList.add('bv-sections');
    this.toolbar = el('div', { class: 'bv-sections-toolbar' });
    this.tableWrap = el('div', { class: 'bv-sections-wrap' });
    this.root.append(this.toolbar, this.tableWrap);

    this.store.subscribe((_s, changed) => {
      if (
        changed.has('sections') ||
        changed.has('activeSectionName') ||
        changed.has('activeFormat') ||
        changed.has('parseError') ||
        changed.has('baseAddress') ||
        changed.has('formatBaseAddress')
      ) {
        this.render();
      }
    });
    this.render();
  }

  render(): void {
    const s = this.store.state;
    clear(this.toolbar);
    clear(this.tableWrap);

    const rows = [...s.sections].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));

    if (rows.length === 0) {
      this.tableWrap.append(
        el('div', { class: 'bv-empty' }, [
          el('p', {
            text: s.activeFormat
              ? `"${s.activeFormat}" defines no sections and its structure has no top-level fields.`
              : 'No sections to show.',
          }),
          el('p', {
            text: 'Add a "sections" array to the format definition (each entry: name, start, length, and optional flags / display).',
          }),
          el('div', { class: 'bv-empty-actions' }, [
            el('button', {
              class: 'bv-btn',
              text: s.activeFormat ? 'Edit Format' : '+ Create Binary Format',
              onclick: () =>
                post({ type: 'openFormatEditor', formatName: s.activeFormat ?? undefined }),
            }),
            el('button', {
              class: 'bv-btn',
              text: 'Generate from file…',
              onclick: () => post({ type: 'generateFormat' }),
            }),
          ]),
        ]),
      );
      return;
    }

    const showFlags = hasFlagsColumn(rows);
    const showDisplay = hasDisplayColumn(rows);
    const derived = rows.every((r) => r.source === 'derived');

    // ---- toolbar ----
    this.toolbar.append(
      el('span', {
        class: 'bv-sections-title',
        text: derived ? 'Sections (derived from structure)' : 'Sections',
      }),
    );
    if (showDisplay) {
      const chk = el('input', {
        type: 'checkbox',
        class: 'bv-check',
        onchange: (e) => {
          this.hideHidden = (e.target as HTMLInputElement).checked;
          this.render();
        },
      }) as HTMLInputElement;
      chk.checked = this.hideHidden;
      this.toolbar.append(
        el('label', { class: 'bv-check-label' }, [chk, document.createTextNode(' Hide "display: No"')]),
      );
    }
    this.toolbar.append(el('span', { class: 'bv-spacer' }));
    if (s.activeFormat) {
      this.toolbar.append(
        el('button', {
          class: 'bv-btn bv-btn-sm',
          text: 'Edit Format',
          onclick: () => post({ type: 'openFormatEditor', formatName: s.activeFormat ?? undefined }),
        }),
      );
    }

    if (derived) {
      this.tableWrap.append(
        el('div', {
          class: 'bv-dim bv-sections-hint',
          text: 'These rows come from the structure top-level fields. Add a "sections" array to the format for explicit names, flags and a display column.',
        }),
      );
    }

    // ---- table ----
    const table = el('table', { class: 'bv-sections-table bv-struct-table' });
    const head = el('tr', {}, [
      el('th', { text: 'Section' }),
      el('th', { text: 'Start' }),
      el('th', { text: 'End' }),
      el('th', { text: 'Length' }),
    ]);
    if (showFlags) {
      head.append(el('th', { text: 'Flags' }));
    }
    if (showDisplay) {
      head.append(el('th', { text: 'Display' }));
    }
    table.append(el('thead', {}, [head]));

    const tbody = el('tbody');
    for (const row of rows) {
      const visible = row.display ?? true;
      if (this.hideHidden && !visible) {
        continue;
      }
      tbody.append(this.sectionRow(row, showFlags, showDisplay, visible));
    }
    table.append(tbody);
    this.tableWrap.append(table);
  }

  private sectionRow(
    row: ParsedSection,
    showFlags: boolean,
    showDisplay: boolean,
    visible: boolean,
  ): HTMLElement {
    const active = row.name === this.store.state.activeSectionName;
    const selectable = row.inFile && row.length > 0 && !row.error;
    const tr = el('tr', {
      class:
        'bv-struct-row bv-section-row' +
        (active ? ' bv-struct-active' : '') +
        (!visible ? ' bv-section-hidden' : '') +
        (row.error || !row.inFile ? ' bv-struct-err' : ''),
      title: row.description ?? (row.inFile ? '' : 'Start address is outside the file'),
    });

    const lenText =
      row.length >= 1024
        ? `${row.length.toLocaleString()}  (${humanFileSize(row.length)})`
        : `${row.length}`;

    tr.append(
      el('td', { class: 'bv-section-name', text: row.name }),
      el('td', { class: 'bv-mono', text: displayAddr(this.store.state, row.start) }),
      el('td', { class: 'bv-mono', text: displayAddr(this.store.state, row.end) }),
      el('td', { class: 'bv-mono', text: row.error ? `<${row.error}>` : lenText }),
    );
    if (showFlags) {
      tr.append(el('td', { class: 'bv-mono bv-section-flags', text: row.flags ?? '' }));
    }
    if (showDisplay) {
      tr.append(el('td', { text: row.display === undefined ? '' : row.display ? 'Yes' : 'No' }));
    }

    tr.addEventListener('click', () => {
      this.store.update({ activeSectionName: row.name });
      if (selectable) {
        selectBytes(this.store, row.start, row.length);
        post({ type: 'selectionChanged', offset: row.start, length: row.length });
      }
    });
    tr.addEventListener('dblclick', () => {
      if (selectable) {
        this.cb.onRevealSection(row.start, row.length);
      }
    });
    return tr;
  }
}
