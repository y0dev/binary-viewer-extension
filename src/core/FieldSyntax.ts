/**
 * Sugar for field `type` strings. Pure.
 *
 * Any type may be written as `<base>[<n>]` to mean "n of these":
 *
 *   { "name": "coeffs", "type": "float32[8]" }
 *   { "name": "samples", "type": "int16[24]" }
 *   { "name": "tag", "type": "char[4]" }         // -> a 4-char string
 *   { "name": "rows", "type": "Record[100]" }    // -> array of a reusable struct
 *
 * Scalars and structure names expand to a proper `array` field; string / byte
 * types expand to their `length` / `size` form instead.
 */

import type { FieldDefinition } from '../types/format';

const SHORTHAND_RE = /^(.+?)\s*\[\s*(\d+)\s*\]$/;
const STRING_BASES = new Set(['char', 'ascii', 'utf8', 'utf16', 'string']);
const SIZED_BASES = new Set(['bytes', 'hex', 'binary', 'padding']);

export function parseArrayShorthand(
  type: string | undefined,
): { base: string; count: number } | null {
  if (typeof type !== 'string') {
    return null;
  }
  const m = SHORTHAND_RE.exec(type.trim());
  if (!m) {
    return null;
  }
  const base = m[1].trim();
  const count = Number.parseInt(m[2], 10);
  if (!base || !Number.isFinite(count) || count < 0) {
    return null;
  }
  return { base, count };
}

/** Expand a single field's `type` shorthand. Non-shorthand fields pass through. */
export function expandShorthandField(field: FieldDefinition): FieldDefinition {
  const sh = parseArrayShorthand(field.type);
  if (!sh) {
    return field;
  }
  const { base, count } = sh;

  if (STRING_BASES.has(base)) {
    return { ...field, type: base, length: field.length ?? count };
  }
  if (SIZED_BASES.has(base)) {
    return { ...field, type: base, size: field.size ?? count };
  }

  // scalar or a reusable-structure name -> array of that element
  const items: FieldDefinition = { name: field.items?.name ?? 'item', type: base };
  if (field.items?.size !== undefined) {
    items.size = field.items.size;
  }
  const out: FieldDefinition = { name: field.name, type: 'array', count, items };
  if (field.offset !== undefined) {
    out.offset = field.offset;
  }
  if (field.endianness !== undefined) {
    out.endianness = field.endianness;
  }
  if (field.description !== undefined) {
    out.description = field.description;
  }
  return out;
}

function isBitSpecs(fields: unknown): boolean {
  return (
    Array.isArray(fields) &&
    fields.length > 0 &&
    typeof (fields[0] as { bits?: unknown }).bits === 'string'
  );
}

/** Recursively expand shorthand through `fields` and array `items`. */
export function expandShorthandDeep(fields: FieldDefinition[]): FieldDefinition[] {
  return fields.map((raw) => {
    const f = expandShorthandField(raw);
    const out: FieldDefinition = { ...f };
    if (Array.isArray(f.fields) && !isBitSpecs(f.fields)) {
      out.fields = expandShorthandDeep(f.fields as FieldDefinition[]);
    }
    if (f.items) {
      const item = expandShorthandField(f.items);
      out.items = Array.isArray(item.fields)
        ? { ...item, fields: expandShorthandDeep(item.fields as FieldDefinition[]) }
        : item;
    }
    return out;
  });
}
