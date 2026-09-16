/**
 * Canonical top-level key order for a generated `FormatDefinition` — used when
 * the format editor's form mode builds the JSON it saves and previews, so the
 * output always reads the same way: `name` first, then the format's metadata,
 * then `fields` last (it's usually the longest part of the document, so
 * keeping it last means everything else stays visible above it).
 *
 * Hand-written JSON (the editor's JSON tab, or a file edited outside the
 * extension) is never reordered — this only governs what the *form* builds.
 */

import type { FormatDefinition } from '../types/format';

export const FORMAT_KEY_ORDER: ReadonlyArray<keyof FormatDefinition> = [
  'name',
  'endianness',
  'description',
  'version',
  'author',
  'fileExtensions',
  'magic',
  'baseAddress',
  'structures',
  'sections',
  'fields',
];

/**
 * A new object with `def`'s own keys re-inserted in `FORMAT_KEY_ORDER`
 * (skipping absent ones), followed by any keys not in that list — so a future
 * field nobody's added to the order yet is still included, just not
 * necessarily in the "right" place, rather than silently dropped.
 *
 * `JSON.stringify` (and JS object iteration generally) follows a plain
 * object's string-key insertion order, so this is what actually decides the
 * key order of the emitted JSON.
 */
export function reorderFormatKeys(def: FormatDefinition): FormatDefinition {
  const src = def as unknown as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of FORMAT_KEY_ORDER) {
    if (def[key] !== undefined) {
      ordered[key] = def[key];
    }
  }
  for (const key of Object.keys(src)) {
    if (!(key in ordered)) {
      ordered[key] = src[key];
    }
  }
  return ordered as unknown as FormatDefinition;
}
