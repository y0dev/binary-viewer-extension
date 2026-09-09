import type { Endianness } from '../types/format';
import type { FormatSummary, ParsedNode, ParsedSection, ViewMode } from '../types/messages';

export interface Selection {
  /** Start byte offset (inclusive). */
  start: number;
  /** Number of bytes selected (>= 1 once a selection exists; 0 == none). */
  length: number;
}

export interface AppState {
  fileSize: number;
  fileName: string;
  view: ViewMode;
  bytesPerRow: 8 | 16 | 32;
  endianness: Endianness;
  showInspector: boolean;

  /** Caret byte offset. */
  caret: number;
  /** Anchor used while extending a selection. */
  anchor: number;
  selection: Selection;

  formats: FormatSummary[];
  activeFormat: string | null;
  detectedFormat: string | null;
  parsed: ParsedNode[];
  parseError: string | null;
  /** Currently highlighted structure node id. */
  activeNodeId: string | null;

  /** Rows for the Sections / memory-map view. */
  sections: ParsedSection[];
  /** Currently highlighted section name. */
  activeSectionName: string | null;

  blockSizeBytes: number;
  maxSearchResults: number;
}

type Listener = (state: AppState, changed: Set<keyof AppState>) => void;

export class Store {
  private listeners = new Set<Listener>();

  constructor(public state: AppState) {}

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  update(patch: Partial<AppState>): void {
    const changed = new Set<keyof AppState>();
    for (const k of Object.keys(patch) as (keyof AppState)[]) {
      if (this.state[k] !== patch[k]) {
        changed.add(k);
      }
    }
    if (changed.size === 0) {
      return;
    }
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) {
      l(this.state, changed);
    }
  }

  /** Force a notification without changing identity (used after data arrives). */
  ping(key: keyof AppState): void {
    for (const l of this.listeners) {
      l(this.state, new Set([key]));
    }
  }
}

export function selectBytes(
  store: Store,
  start: number,
  length: number,
  opts: { setAnchor?: boolean } = {},
): void {
  const clampedStart = Math.max(0, Math.min(start, Math.max(0, store.state.fileSize - 1)));
  const maxLen = store.state.fileSize - clampedStart;
  const clampedLen = Math.max(0, Math.min(length, maxLen));
  store.update({
    selection: { start: clampedStart, length: clampedLen },
    caret: clampedStart,
    anchor: opts.setAnchor === false ? store.state.anchor : clampedStart,
  });
}
