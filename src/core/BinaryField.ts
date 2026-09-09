/**
 * Field layout helpers: given a FieldDefinition, work out how many bytes it
 * occupies. Used by the parser to lay out packed (offset-less) fields and to
 * bound range reads. Pure.
 */

import type { EnumEntry, FieldDefinition } from '../types/format';
import { getScalarType } from './DataTypes';
import { isContainerForm, containerChildren } from './FieldShape';
import { expandShorthandField } from './FieldSyntax';

/**
 * Total bytes a container occupies: explicit `size` if given, otherwise the
 * largest child end offset (children packed after the previous sibling when
 * they omit their own offset). Nested containers recurse through this.
 */
export function computeStructSize(field: FieldDefinition): number {
  let end = 0;
  let cursor = 0;
  for (const f of containerChildren(field)) {
    const at = f.offset ?? cursor;
    let sz = 0;
    try {
      sz = computeFieldSize(f);
    } catch {
      // A child of unknowable size (e.g. variable-length) does not advance the
      // cursor; the explicit `size` (if any) still governs.
      sz = 0;
    }
    end = Math.max(end, at + sz);
    cursor = at + sz;
  }
  return field.size ?? end;
}

/**
 * True when any field in the tree is sized only at parse time — an `array`
 * with `countField` and no fixed `count`. Callers that need to bound a read
 * ahead of parsing (the editor's decode window) must widen it in that case,
 * since `computeFieldSize` reports 0 for such a field.
 */
export function hasParseTimeSize(fields: readonly FieldDefinition[] | undefined): boolean {
  for (const f of fields ?? []) {
    if (f.type === 'array' && f.countField && f.count === undefined) {
      return true;
    }
    if (f.items && hasParseTimeSize([f.items])) {
      return true;
    }
    if (Array.isArray(f.fields) && hasParseTimeSize(f.fields as FieldDefinition[])) {
      return true;
    }
  }
  return false;
}

/** Bytes consumed by a field. Returns 0 for zero-length, throws on unknowable. */
export function computeFieldSize(field: FieldDefinition): number {
  // Normalise "float32[8]"-style shorthand first.
  const expanded = expandShorthandField(field);
  if (expanded !== field) {
    return computeFieldSize(expanded);
  }
  const t = field.type;

  // A field with nested `fields` (and no scalar type) is a structure/container.
  if (isContainerForm(field)) {
    return computeStructSize(field);
  }

  if (t === 'char' && (field.length !== undefined || field.count !== undefined)) {
    return field.size ?? (field.length ?? field.count)!;
  }
  const scalar = getScalarType(t);
  if (scalar) {
    return field.size ?? scalar.size;
  }
  switch (t) {
    case 'bool':
    case 'boolean':
      return 1;
    case 'padding':
    case 'bytes':
    case 'hex':
    case 'binary':
      return req(field.size ?? field.length, field, 'size');
    case 'ascii':
    case 'utf8':
    case 'string':
      return field.size ?? req(field.length, field, 'length');
    case 'utf16':
      return field.size ?? req(field.length, field, 'length') * 2;
    case 'enum':
      return field.size ?? 4;
    case 'flags':
    case 'bitfield':
      return field.size ?? 1;
    case 'timestamp':
      return field.timestamp?.size ?? 4;
    case 'array': {
      if (!field.items) {
        throw new Error(`array field "${field.name}" is missing "items"`);
      }
      const each = computeFieldSize({ ...field.items, name: field.items.name || 'item' });
      // A `countField`-sized array has no static size; the parser fixes it up
      // from the decoded length prefix at parse time.
      return each * (field.count ?? 0);
    }
    case 'struct':
      return computeStructSize(field);
    default:
      throw new Error(`Cannot determine size of type "${t}" for field "${field.name}"`);
  }
}

function req(value: number | undefined, field: FieldDefinition, prop: string): number {
  if (value === undefined) {
    throw new Error(`field "${field.name}" (${field.type}) requires "${prop}"`);
  }
  return value;
}

/** Normalize either enum shape into a value(string) -> label map. */
export function normalizeEnum(
  e: Record<string, string | number> | EnumEntry[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!e) {
    return map;
  }
  if (Array.isArray(e)) {
    for (const entry of e) {
      map.set(String(entry.value), entry.name);
    }
    return map;
  }
  // Heuristic: if every value is a number, treat keys as labels (label->value);
  // otherwise treat as value->label.
  const values = Object.values(e);
  const keysAreNumeric = Object.keys(e).every((k) => /^-?\d+$/.test(k) || /^0x[0-9a-f]+$/i.test(k));
  if (keysAreNumeric) {
    for (const [k, v] of Object.entries(e)) {
      const num = k.toLowerCase().startsWith('0x') ? parseInt(k, 16) : parseInt(k, 10);
      map.set(String(num), String(v));
    }
  } else if (values.every((v) => typeof v === 'number')) {
    for (const [k, v] of Object.entries(e)) {
      map.set(String(v), k);
    }
  } else {
    for (const [k, v] of Object.entries(e)) {
      map.set(k, String(v));
    }
  }
  return map;
}

export function lookupEnumLabel(
  e: Record<string, string | number> | EnumEntry[] | undefined,
  value: number | bigint,
): string | undefined {
  const map = normalizeEnum(e);
  return map.get(value.toString());
}
