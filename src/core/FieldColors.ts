/**
 * Pure helpers for the raw view's optional "Field Colors" overlay: tint each
 * byte by the top-level field it belongs to, so field boundaries are visible
 * directly in the hex dump. Requires a parsed structure (an applied format) —
 * with none, there is nothing to color by.
 */

import type { ParsedNode } from '../types/messages';

/** Colorblind-safe categorical palette (Okabe–Ito), cycled by field order. */
export const FIELD_HIGHLIGHT_PALETTE = [
  '#e69f00',
  '#56b4e9',
  '#009e73',
  '#f0e442',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
  '#66c2a5',
] as const;

export interface FieldColorRange {
  /** Absolute file offset, inclusive. */
  start: number;
  /** Absolute file offset, exclusive. */
  end: number;
  /** A palette entry, e.g. `"#e69f00"`. */
  color: string;
}

/**
 * One color range per *top-level* field (depth 0), in field-definition order
 * cycling through the palette, sorted by offset for lookup. Nested children
 * inherit their top-level ancestor's color implicitly — the raw view is a
 * byte grid, not a tree, so it colors by the outermost field only.
 */
export function computeFieldColorRanges(
  nodes: ReadonlyArray<Pick<ParsedNode, 'offset' | 'size' | 'depth'>>,
): FieldColorRange[] {
  const top = nodes.filter((n) => n.depth === 0 && n.size > 0);
  const ranges: FieldColorRange[] = top.map((n, i) => ({
    start: n.offset,
    end: n.offset + n.size,
    color: FIELD_HIGHLIGHT_PALETTE[i % FIELD_HIGHLIGHT_PALETTE.length],
  }));
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

/**
 * The color range covering byte offset `o`, if any. `ranges` must be sorted by
 * `start` (as returned by `computeFieldColorRanges`); binary search.
 */
export function fieldColorAt(ranges: readonly FieldColorRange[], o: number): string | undefined {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (o < r.start) {
      hi = mid - 1;
    } else if (o >= r.end) {
      lo = mid + 1;
    } else {
      return r.color;
    }
  }
  return undefined;
}
