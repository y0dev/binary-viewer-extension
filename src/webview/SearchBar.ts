import { Store } from './state';
import { el } from './dom';
import { post } from './vscodeApi';
import { offsetHex } from '../core/humanize';
import { compileSearch } from '../core/SearchPattern';
import type { HostToWebview, SearchMatch, SearchQuery } from '../types/messages';

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
  private cancelButton: HTMLButtonElement;
  private requestSeq = 0;
  private activeRequest: number | undefined;
  private truncated = false;
  private cancelled = false;
  private failed = false;

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

    this.status = el('span', { id: 'bv-search-status', class: 'bv-search-status', role: 'status', 'aria-live': 'polite' });
    this.input.setAttribute('aria-label', 'Search pattern');
    this.input.setAttribute('aria-describedby', 'bv-search-status');
    this.kindSel.setAttribute('aria-label', 'Search encoding');
    this.caseChk.setAttribute('aria-label', 'Ignore ASCII case');
    this.cancelButton = el('button', {
      class: 'bv-btn bv-btn-sm', text: 'Cancel', hidden: true,
      onclick: () => this.cancel(),
    });

    this.root.append(
      el('label', { class: 'bv-label', text: 'Find:' }),
      this.kindSel,
      this.input,
      caseLabel,
      el('button', { class: 'bv-btn bv-btn-sm', text: '<', title: 'Find previous (Shift+Enter)', onclick: () => this.prev() }),
      el('button', { class: 'bv-btn bv-btn-sm', text: '>', title: 'Find next (Enter)', onclick: () => this.next() }),
      el('button', { class: 'bv-btn bv-btn-sm', text: 'All', title: 'Find all', onclick: () => this.all() }),
      this.status,
      this.cancelButton,
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
    this.cancel();
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
    this.cancel();
    this.status.textContent = '';
    this.input.removeAttribute('aria-invalid');
    this.truncated = false;
    this.cancelled = false;
    this.failed = false;
    this.status.classList.remove('bv-search-error');
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
    this.cancel();
    this.input.removeAttribute('aria-invalid');
    try {
      compileSearch(q);
    } catch (e) {
      this.status.textContent = (e as Error).message;
      this.input.setAttribute('aria-invalid', 'true');
      this.status.classList.add('bv-search-error');
      return;
    }
    this.matches = [];
    this.index = 0;
    this.allMode = q.direction === 'all';
    this.truncated = false;
    this.cancelled = false;
    this.failed = false;
    this.status.classList.remove('bv-search-error');
    this.searching = true;
    this.cancelButton.hidden = false;
    this.status.textContent = 'Searching…';
    this.lastKey = this.key();
    this.activeRequest = ++this.requestSeq;
    post({ type: 'search', requestId: this.activeRequest, query: q });
  }

  private cancel(): void {
    if (this.activeRequest !== undefined) {
      post({ type: 'cancelSearch', requestId: this.activeRequest });
      this.activeRequest = undefined;
    }
    if (this.searching) {
      this.cancelled = true;
      this.status.textContent = `Cancelled${this.matches.length ? ` — ${this.matches.length} matches (incomplete)` : ''}`;
    }
    this.searching = false;
    this.cancelButton.hidden = true;
  }

  // ---- result handling ---------------------------------------

  onError(requestId: number, message: string): void {
    if (requestId !== this.activeRequest) { return; }
    this.activeRequest = undefined;
    this.searching = false;
    this.cancelButton.hidden = true;
    this.failed = true;
    this.status.classList.add('bv-search-error');
    this.status.textContent = `${message}${this.matches.length ? ' — results incomplete' : ''}`;
  }

  onResult(result: Extract<HostToWebview, { type: 'searchResult' }>): void {
    const { requestId, query, matches, done, scannedTo, truncated } = result;
    if (requestId !== this.activeRequest) { return; }
    const firstBatch = this.matches.length === 0;
    this.matches.push(...matches);
    this.truncated = !!truncated;
    this.searching = !done;
    this.cancelButton.hidden = done;
    if (done) { this.activeRequest = undefined; }

    if (query.direction === 'all') {
      if (firstBatch && matches.length) { this.selectCurrent(); }
      if (!done) {
        const total = Math.max(1, this.store.state.fileSize);
        const percent = Math.min(100, Math.floor(scannedTo / total * 100));
        this.status.textContent = `Searching… ${percent}% — ${this.matches.length} matches`;
      } else {
        this.status.textContent = this.matches.length
          ? this.matchStatus()
          : 'No matches';
      }
      return;
    }

    if (!done) {
      const distance = query.direction === 'previous'
        ? query.from - scannedTo : scannedTo - query.from;
      const total = query.direction === 'previous'
        ? query.from : this.store.state.fileSize - query.from;
      this.status.textContent = `Searching… ${Math.min(100, Math.floor(distance / Math.max(1, total) * 100))}%`;
      return;
    }
    if (!this.matches.length) {
      this.status.textContent = 'Not found';
      return;
    }
    const m = this.matches[0];
    this.lastOffset = m.offset;
    this.cb.onSelect(m.offset, m.length);
    this.status.textContent = offsetHex(m.offset);
  }

  private matchStatus(): string {
    const suffix = this.truncated ? ' — result limit reached (incomplete)'
      : this.failed ? ' — scan failed (incomplete)'
      : this.cancelled ? ' — cancelled (incomplete)'
      : this.searching ? ' — searching…' : '';
    return `${this.index + 1} / ${this.matches.length}${suffix}`;
  }

  private selectCurrent(): void {
    const m = this.matches[this.index];
    if (!m) {
      return;
    }
    this.lastOffset = m.offset;
    this.cb.onSelect(m.offset, m.length);
    this.status.textContent = this.matchStatus();
  }

  get busy(): boolean {
    return this.searching;
  }
}
