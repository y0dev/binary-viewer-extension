import { Store, selectBytes } from './state';
import { el, clear } from './dom';
import { post } from './vscodeApi';
import { offsetHex } from '../core/humanize';
import type { ParsedNode } from '../types/messages';

export interface StructureCallbacks {
  onRevealField(offset: number, length: number): void;
}

export class StructureView {
  private toolbar: HTMLDivElement;
  private tableWrap: HTMLDivElement;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private cb: StructureCallbacks,
  ) {
    this.root.classList.add('bv-structure');
    this.toolbar = el('div', { class: 'bv-struct-toolbar' });
    this.tableWrap = el('div', { class: 'bv-struct-wrap' });
    this.root.append(this.toolbar, this.tableWrap);

    this.store.subscribe((_s, changed) => {
      if (
        changed.has('parsed') ||
        changed.has('parseError') ||
        changed.has('activeFormat') ||
        changed.has('activeNodeId') ||
        changed.has('formats')
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

    if (!s.activeFormat) {
      this.tableWrap.append(
        el('div', { class: 'bv-empty' }, [
          el('p', { text: 'No structure format applied.' }),
          s.formats.length
            ? el('p', { text: 'Pick a format from the toolbar above, or create one:' })
            : el('p', { text: 'Create a binary format to decode this file:' }),
          el('button', {
            class: 'bv-btn',
            text: '+ Create Binary Format',
            onclick: () => post({ type: 'openFormatEditor' }),
          }),
        ]),
      );
      return;
    }

    this.toolbar.append(
      el('span', { class: 'bv-struct-fmt', text: `Format: ${s.activeFormat}` }),
      el('span', { class: 'bv-spacer' }),
      el('button', {
        class: 'bv-btn bv-btn-sm',
        text: 'Edit Format',
        onclick: () => post({ type: 'openFormatEditor', formatName: s.activeFormat ?? undefined }),
      }),
    );

    if (s.parseError) {
      this.tableWrap.append(el('div', { class: 'bv-error', text: `Parse error: ${s.parseError}` }));
    }
    if (s.parsed.length === 0 && !s.parseError) {
      this.tableWrap.append(el('div', { class: 'bv-empty', text: 'Parsing...' }));
      return;
    }

    const table = el('table', { class: 'bv-struct-table' });
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Offset' }),
          el('th', { text: 'Name' }),
          el('th', { text: 'Type' }),
          el('th', { text: 'Value' }),
        ]),
      ]),
    );
    const tbody = el('tbody');
    for (const node of s.parsed) {
      tbody.append(this.nodeRow(node));
      if (node.bits && node.bits.length) {
        tbody.append(this.bitGridRow(node));
        for (const bit of node.bits) {
          tbody.append(
            el('tr', { class: 'bv-bit-row' }, [
              el('td', { text: '' }),
              el('td', { class: 'bv-bit-name', text: `  bit ${bit.bitLabel}  ${bit.name}` }),
              el('td', { text: '' }),
              el('td', { text: bit.value + (bit.description ? `   — ${bit.description}` : '') }),
            ]),
          );
        }
      }
    }
    table.append(tbody);
    this.tableWrap.append(table);
  }

  private nodeRow(node: ParsedNode): HTMLElement {
    const active = node.id === this.store.state.activeNodeId;
    const tr = el('tr', {
      class:
        'bv-struct-row' +
        (active ? ' bv-struct-active' : '') +
        (node.error ? ' bv-struct-err' : ''),
      'data-id': node.id,
      title: node.detail ?? '',
      onclick: () => this.selectNode(node),
      ondblclick: () => {
        this.selectNode(node);
        this.cb.onRevealField(node.offset, node.size);
      },
    });
    const indent = '  '.repeat(node.depth);
    tr.append(
      el('td', { class: 'bv-mono', text: node.size > 0 ? offsetHex(node.offset) : '' }),
      el('td', { text: indent + node.name }),
      el('td', { class: 'bv-mono bv-dim', text: node.typeLabel }),
      el('td', { class: 'bv-struct-val', text: node.error ? `<${node.error}>` : node.value }),
    );
    return tr;
  }

  private bitGridRow(node: ParsedNode): HTMLElement {
    // Render "Bit 7 6 5 4 3 2 1 0" header for the container width implied by size.
    const bitsWide = Math.min(64, Math.max(8, node.size * 8));
    const header: string[] = [];
    for (let i = bitsWide - 1; i >= 0; i--) {
      header.push(i.toString().padStart(2, ' '));
    }
    return el('tr', { class: 'bv-bit-grid-row' }, [
      el('td', { text: '' }),
      el('td', { colspan: '3' }, [
        el('span', { class: 'bv-dim', text: 'Bit ' }),
        el('span', { class: 'bv-mono', text: header.join(' ') }),
      ]),
    ]);
  }

  private selectNode(node: ParsedNode): void {
    this.store.update({ activeNodeId: node.id });
    if (node.size > 0) {
      selectBytes(this.store, node.offset, node.size);
      post({ type: 'selectionChanged', offset: node.offset, length: node.size });
    }
  }
}
