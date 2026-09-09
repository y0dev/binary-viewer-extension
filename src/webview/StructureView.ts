import { Store, selectBytes, displayAddr } from './state';
import { el, clear } from './dom';
import { post } from './vscodeApi';
import type { ParsedNode } from '../types/messages';

export interface StructureCallbacks {
  onRevealField(offset: number, length: number): void;
}

const ROOT_ID = '__root__';

export class StructureView {
  private toolbar: HTMLDivElement;
  private breadcrumb: HTMLDivElement;
  private tableWrap: HTMLDivElement;

  /** Session memory of collapsed container ids (default: everything expanded). */
  private collapsed = new Set<string>();
  private lastFormat: string | null = null;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private cb: StructureCallbacks,
  ) {
    this.root.classList.add('bv-structure');
    this.toolbar = el('div', { class: 'bv-struct-toolbar' });
    this.breadcrumb = el('div', { class: 'bv-breadcrumb' });
    this.tableWrap = el('div', { class: 'bv-struct-wrap' });
    this.root.append(this.toolbar, this.breadcrumb, this.tableWrap);

    this.store.subscribe((_s, changed) => {
      if (
        changed.has('parsed') ||
        changed.has('parseError') ||
        changed.has('activeFormat') ||
        changed.has('activeNodeId') ||
        changed.has('formats') ||
        changed.has('baseAddress') ||
        changed.has('formatBaseAddress')
      ) {
        this.render();
      }
    });
    this.render();
  }

  private buildIndex(nodes: ParsedNode[]): {
    byId: Map<string, ParsedNode>;
    childrenOf: Map<string, ParsedNode[]>;
  } {
    const byId = new Map<string, ParsedNode>();
    const childrenOf = new Map<string, ParsedNode[]>();
    for (const n of nodes) {
      byId.set(n.id, n);
      const key = n.parentId ?? ROOT_ID;
      (childrenOf.get(key) ?? childrenOf.set(key, []).get(key)!).push(n);
    }
    return { byId, childrenOf };
  }

  private ancestors(node: ParsedNode, byId: Map<string, ParsedNode>): ParsedNode[] {
    const chain: ParsedNode[] = [];
    let cur: ParsedNode | undefined = node;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return chain;
  }

  private isVisible(node: ParsedNode, byId: Map<string, ParsedNode>): boolean {
    if (this.collapsed.has(ROOT_ID)) {
      return false;
    }
    let p = node.parentId ?? null;
    while (p) {
      if (this.collapsed.has(p)) {
        return false;
      }
      p = byId.get(p)?.parentId ?? null;
    }
    return true;
  }

  private toggle(id: string): void {
    if (this.collapsed.has(id)) {
      this.collapsed.delete(id);
    } else {
      this.collapsed.add(id);
    }
    this.render();
  }

  render(): void {
    const s = this.store.state;
    if (s.activeFormat !== this.lastFormat) {
      this.collapsed.clear();
      this.lastFormat = s.activeFormat;
    }
    clear(this.toolbar);
    clear(this.breadcrumb);
    clear(this.tableWrap);

    if (!s.activeFormat) {
      this.breadcrumb.hidden = true;
      this.tableWrap.append(
        el('div', { class: 'bv-empty' }, [
          el('p', { text: 'No structure format applied.' }),
          s.formats.length
            ? el('p', { text: 'Pick a format from the toolbar above, or start one:' })
            : el('p', { text: 'Start a binary format to decode this file:' }),
          el('div', { class: 'bv-empty-actions' }, [
            el('button', {
              class: 'bv-btn',
              text: '+ Create Binary Format',
              onclick: () => post({ type: 'openFormatEditor' }),
            }),
            el('button', {
              class: 'bv-btn',
              text: 'Generate from file / selection…',
              onclick: () => post({ type: 'generateFormat' }),
            }),
          ]),
          el('p', {
            class: 'bv-dim',
            text: 'Tip: select a large repeating region in Raw first, then "Generate" to scaffold an array.',
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
        text: 'Expand all',
        onclick: () => {
          this.collapsed.clear();
          this.render();
        },
      }),
      el('button', {
        class: 'bv-btn bv-btn-sm',
        text: 'Collapse all',
        onclick: () => {
          for (const n of this.store.state.parsed) {
            if (n.isContainer) {
              this.collapsed.add(n.id);
            }
          }
          this.render();
        },
      }),
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
      this.breadcrumb.hidden = true;
      this.tableWrap.append(el('div', { class: 'bv-empty', text: 'Parsing...' }));
      return;
    }

    const { byId, childrenOf } = this.buildIndex(s.parsed);

    this.renderBreadcrumb(s.activeFormat, s.activeNodeId, byId);

    const table = el('table', { class: 'bv-struct-table' });
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Name' }),
          el('th', { text: 'Offset' }),
          el('th', { text: 'Type' }),
          el('th', { text: 'Value / Size' }),
        ]),
      ]),
    );
    const tbody = el('tbody');

    // Synthetic root row for the whole format.
    const rootChildren = childrenOf.get(ROOT_ID) ?? [];
    const rootEnd = rootChildren.reduce((m, n) => Math.max(m, n.offset + n.size), 0);
    tbody.append(this.rootRow(s.activeFormat, rootChildren.length, rootEnd));

    for (const node of s.parsed) {
      if (!this.isVisible(node, byId)) {
        continue;
      }
      tbody.append(this.nodeRow(node));
      if (node.bits && node.bits.length && !this.collapsed.has(node.id)) {
        tbody.append(this.bitGridRow(node));
        for (const bit of node.bits) {
          tbody.append(
            el('tr', { class: 'bv-bit-row' }, [
              el('td', {
                class: 'bv-bit-name',
                style: `padding-left:${(node.depth + 3) * 14}px`,
                text: `bit ${bit.bitLabel}  ${bit.name}`,
              }),
              el('td', { text: '' }),
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

  private renderBreadcrumb(
    formatName: string,
    activeId: string | null,
    byId: Map<string, ParsedNode>,
  ): void {
    this.breadcrumb.hidden = false;
    const crumbs: HTMLElement[] = [
      el('span', {
        class: 'bv-crumb bv-crumb-root',
        text: formatName,
        onclick: () => this.store.update({ activeNodeId: null }),
      }),
    ];
    const active = activeId ? byId.get(activeId) : undefined;
    if (active) {
      for (const anc of this.ancestors(active, byId)) {
        crumbs.push(el('span', { class: 'bv-crumb-sep', text: '›' }));
        crumbs.push(
          el('span', {
            class: 'bv-crumb' + (anc.id === activeId ? ' bv-crumb-active' : ''),
            text: anc.name,
            onclick: () => this.selectNode(anc),
          }),
        );
      }
    } else {
      this.breadcrumb.append(...crumbs, el('span', { class: 'bv-dim', text: '  (select a field)' }));
      return;
    }
    this.breadcrumb.append(...crumbs);
  }

  private rootRow(formatName: string, childCount: number, endOffset: number): HTMLElement {
    const collapsedRoot = this.collapsed.has(ROOT_ID);
    const tr = el('tr', { class: 'bv-struct-row bv-struct-container bv-struct-root' });
    const arrow = el('span', {
      class: 'bv-disclosure',
      text: collapsedRoot ? '▶' : '▼',
      onclick: (e) => {
        (e as Event).stopPropagation();
        this.toggle(ROOT_ID);
      },
    });
    tr.append(
      el('td', {}, [arrow, el('span', { class: 'bv-node-name', text: formatName })]),
      el('td', { class: 'bv-mono', text: displayAddr(this.store.state, 0) }),
      el('td', { class: 'bv-mono bv-dim', text: 'format' }),
      el('td', { class: 'bv-struct-val bv-dim', text: `${childCount} top-level, ${endOffset} bytes` }),
    );
    tr.addEventListener('click', () => this.toggle(ROOT_ID));
    return tr;
  }

  private nodeRow(node: ParsedNode): HTMLElement {
    const active = node.id === this.store.state.activeNodeId;
    const expandable = !!node.isContainer || !!(node.bits && node.bits.length);
    const isCollapsed = this.collapsed.has(node.id);
    const tr = el('tr', {
      class:
        'bv-struct-row' +
        (node.isContainer ? ' bv-struct-container' : '') +
        (active ? ' bv-struct-active' : '') +
        (node.error ? ' bv-struct-err' : ''),
      'data-id': node.id,
      title: node.detail ?? '',
    });

    const indentPx = (node.depth + 1) * 14;
    const nameCell = el('td', { style: `padding-left:${indentPx}px` });
    if (expandable) {
      nameCell.append(
        el('span', {
          class: 'bv-disclosure',
          text: isCollapsed ? '▶' : '▼',
          onclick: (e) => {
            (e as Event).stopPropagation();
            this.toggle(node.id);
          },
        }),
      );
    } else {
      nameCell.append(el('span', { class: 'bv-disclosure bv-disclosure-empty', text: '' }));
    }
    nameCell.append(el('span', { class: 'bv-node-name', text: node.name }));

    tr.append(
      nameCell,
      el('td', { class: 'bv-mono', text: displayAddr(this.store.state, node.offset) }),
      el('td', { class: 'bv-mono bv-dim', text: node.typeLabel }),
      el('td', {
        class: 'bv-struct-val' + (node.isContainer ? ' bv-dim' : ''),
        text: node.error ? `<${node.error}>` : node.value,
      }),
    );

    tr.addEventListener('click', () => this.selectNode(node));
    tr.addEventListener('dblclick', () => {
      this.selectNode(node);
      this.cb.onRevealField(node.offset, node.size);
    });
    return tr;
  }

  private bitGridRow(node: ParsedNode): HTMLElement {
    const bitsWide = Math.min(64, Math.max(8, node.size * 8));
    const header: string[] = [];
    for (let i = bitsWide - 1; i >= 0; i--) {
      header.push(i.toString().padStart(2, ' '));
    }
    return el('tr', { class: 'bv-bit-grid-row' }, [
      el('td', { style: `padding-left:${(node.depth + 3) * 14}px` }, [
        el('span', { class: 'bv-dim', text: 'Bit ' }),
        el('span', { class: 'bv-mono', text: header.join(' ') }),
      ]),
      el('td', { text: '' }),
      el('td', { text: '' }),
      el('td', { text: '' }),
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
