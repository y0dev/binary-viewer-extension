/**
 * Pure helpers for an `array` field's optional `view` — which element indices
 * the Structure view actually renders. Most useful on a large array (imagine
 * one with 1000+ elements) where you only care about a slice of it, e.g.
 * `"20...35"` instead of always starting at element 0.
 */

import type { FieldDefinition } from '../types/format';

export interface ResolvedArrayView {
  /** First element index shown, 0-based, inclusive. */
  start: number;
  /** Last element index shown, 0-based, inclusive. */
  end: number;
}

/** `"20...35"` or `"20..35"` — both endpoints inclusive, either order. */
const VIEW_STRING_RE = /^\s*(\d+)\s*\.{2,3}\s*(\d+)\s*$/;

export function isViewString(view: unknown): view is string {
  return typeof view === 'string' && VIEW_STRING_RE.test(view);
}

/** True when `view` is a value that at least *looks* like a view (string or a plain object), for validation. */
export function looksLikeArrayView(view: unknown): boolean {
  return typeof view === 'string' || (typeof view === 'object' && view !== null && !Array.isArray(view));
}

/**
 * Resolve an array field's `view` (a `{ start, end }` object, or the shorthand
 * string `"start...end"`, both inclusive and either order) against the array's
 * actual element count. Returns `null` when there's no view (render from
 * element 0, as always) or it's unusable against this count (count is 0).
 */
export function resolveArrayView(
  view: FieldDefinition['view'],
  count: number,
): ResolvedArrayView | null {
  if (view === undefined || count <= 0) {
    return null;
  }
  let rawStart: number | undefined;
  let rawEnd: number | undefined;
  if (typeof view === 'string') {
    const m = VIEW_STRING_RE.exec(view);
    if (!m) {
      return null;
    }
    rawStart = Number.parseInt(m[1], 10);
    rawEnd = Number.parseInt(m[2], 10);
  } else if (view && typeof view === 'object') {
    const v = view as { start?: number; end?: number };
    rawStart = v.start;
    rawEnd = v.end;
  } else {
    return null;
  }
  if (rawStart === undefined && rawEnd === undefined) {
    return null;
  }
  const a = rawStart ?? 0;
  const b = rawEnd ?? count - 1;
  // Accept either order — "35...20" means the same as "20...35".
  const start = Math.max(0, Math.min(a, b, count - 1));
  const end = Math.max(0, Math.min(Math.max(a, b), count - 1));
  return { start, end };
}
