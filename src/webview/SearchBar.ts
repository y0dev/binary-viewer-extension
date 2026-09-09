import { Store } from './state';
import { el } from './dom';
import { post } from './vscodeApi';
import { offsetHex } from '../core/humanize';
import type { SearchMatch, SearchQuery } from '../types/messages';

export interface SearchCallbacks {
  onSelect(offset: number, length: number): void;
}

type Kind = SearchQuery['kind'];

export class SearchBar {
  private kindSel: HTMLSelectElement;
  private input: HTMLInputElement;
  private caseChk: HTMLInputElement;
  private status: HTMLElement;
  private matches: SearchMatch[] = [];
  private index = 0;
  private allMode = false;
  private lastKey = '';
  private lastOffset = -1;
  private searching = false;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private cb: SearchCallbacks,
  ) {
    this.root.classList.add('bv-searchbar');
    this.root.hidden = true;

    this.kindSel = el('select', { class: 'bv-select' }) as HTMLSelectElement;
    for (const [v, label] of [
      ['hex', 'Hex'],
      ['ascii', 'Text'],
      ['utf8', 'UTF-8'],
      ['utf16', 'UTF-16'],
      ['bits', 'Bits'],
    ] as [Kind, string][]) {
      this.kindSel.append(el('option', { value: v, text: label }));
    }
    this.kindSel.addEventListener('change', () => {
      this.caseChk.parentElement!.hidden = this.kindSel.value !== 'ascii';
      this.updatePlaceholder();
      this.reset();
    });

    this.input = el('input', {
      class: 'bv-input',
      type: 'text',
      placeholder: 'FF 00 A5 10',
      onkeydown: (e) => {
        const ev = e as KeyboardEvent;
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (ev.shiftKey) {
            this.prev();
          } else {
            this.next();
          }
        } else if (ev.key === 'Escape') {
          this.hide();
        }
      },
      oninput: () => this.reset(),
    }) as HTMLInputElement;

    this.caseChk = el('input', { type: 'checkbox', class: 'bv-check' }) as HTMLInputElement;
    this.caseChk.addEventListener('change', () => this.reset());
    const caseLabel = el('label', { class: 'bv-check-label', hidden: true }, [
      this.caseChk,
      document.createTextNode(' Aa'),
    ]);

    this.status = el('span', { class: 'bv-search-status' });

    this.root.append(
      el('label', { class: 'bv-label', text: 'Find:' }),
      this.kindSel,
      this.input,
      caseLabel,
      el('button', { class: 'bv-btn bv-btn-sm', text: '<', title: 'Find previous (Shift+Enter)', onclick: () => this.prev() }),
      el('button', { class: 'bv-btn bv-btn-sm', text: '>', title: 'Find next (Enter)', onclick: () => this.next() }),
      el('button', { class: 'bv-btn bv-btn-sm', text: 'All', title: 'Find all', onclick: () => this.all() }),
      this.status,
      el('span', { class: 'bv-spacer' }),
      el('button', { class: 'bv-btn bv-btn-sm', text: 'x', title: 'Close (Esc)', onclick: () => this.hide() }),
    );
  }

  toggle(): void {
    if (this.root.hidden) {
      this.show();
    } else {
      this.hide();
    }
  }

  show(): void {
    this.root.hidden = false;
    this.input.focus();
    this.input.select();
  }

  hide(): void {
    this.root.hidden = true;
  }

  nav(direction: 'next' | 'previous'): void {
    if (this.root.hidden) {
      this.show();
    }
    if (direction === 'next') {
      this.next();
    } else {
      this.prev();
    }
  }

  // ---- query building -------------------------------------------

  private buildQuery(direction: SearchQuery['direction'], from: number): SearchQuery | null {
    const text = this.input.value;
    if (text.trim() === '') {
      return null;
    }
    return {
      kind: this.kindSel.value as Kind,
      text,
      caseInsensitive: this.kindSel.value === 'ascii' ? this.caseChk.checked : undefined,
      from,
      direction,
    };
  }

  private key(): string {
    return `${this.kindSel.value}|${this.input.value}|${this.caseChk.checked}`;
  }

  private reset(): void {
    this.matches = [];
    this.index = 0;
    this.allMode = false;
    this.lastOffset = -1;
    this.updatePlaceholder();
  }

  private updatePlaceholder(): void {
    const map: Record<string, string> = {
      hex: 'FF 00 A5 10   (?? = wildcard)',
      ascii: 'HELLO',
      utf8: 'text',
      utf16: 'text',
      bits: '10101010',
    };
    this.input.placeholder = map[this.kindSel.value] ?? '';
  }

  // ---- actions -------------------------------------------------

  private next(): void {
    if (this.allMode && this.matches.length) {
      this.index = (this.index + 1) % this.matches.length;
      this.selectCurrent();
      return;
    }
    const sameQuery = this.key() === this.lastKey;
    const from = sameQuery && this.lastOffset >= 0 ? this.lastOffset + 1 : this.store.state.selection.start;
    const q = this.buildQuery('next', Math.max(0, from));
    if (q) {
      this.dispatch(q);
    }
  }

  private prev(): void {
    if (this.allMode && this.matches.length) {
      this.index = (this.index - 1 + this.matches.length) % this.matches.length;
      this.selectCurrent();
      return;
    }
    const sameQuery = this.key() === this.lastKey;
    const from = sameQuery && this.lastOffset >= 0 ? this.lastOffset : this.store.state.selection.start;
    const q = this.buildQuery('previous', Math.max(0, from));
    if (q) {
      this.dispatch(q);
    }
  }

  private all(): void {
    const q = this.buildQuery('all', 0);
    if (q) {
      this.dispatch(q);
    }
  }

  private dispatch(q: SearchQuery): void {
    this.searching = true;
    this.status.textContent = 'searching...';
    this.lastKey = this.key();
    post({ type: 'search', query: q });
  }

  // ---- result handling ---------------------------------------

  onResult(query: SearchQuery, matches: SearchMatch[], done: boolean): void {
    this.searching = false;
    if (query.direction === 'all') {
      this.allMode = true;
      this.matches = matches;
      this.index = 0;
      if (matches.length === 0) {
        this.status.textContent = done ? 'no matches' : 'no matches yet...';
        return;
      }
      this.selectCurrent();
      this.status.textContent = `${this.index + 1} / ${matches.length}${done ? '' : '+'}`;
      return;
    }

    if (matches.length === 0) {
      this.status.textContent = done ? 'not found' : 'not found (partial scan)';
      return;
    }
    this.allMode = false;
    const m = matches[0];
    this.matches = [m];
    this.index = 0;
    this.lastOffset = m.offset;
    this.cb.onSelect(m.offset, m.length);
    this.status.textContent = `${offsetHex(m.offset)}`;
  }

  private selectCurrent(): void {
    const m = this.matches[this.index];
    if (!m) {
      return;
    }
    this.lastOffset = m.offset;
    this.cb.onSelect(m.offset, m.length);
    this.status.textContent = `${this.index + 1} / ${this.matches.length}`;
  }

  get busy(): boolean {
    return this.searching;
  }
}
