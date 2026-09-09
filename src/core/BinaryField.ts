/**
 * Field layout helpers: given a FieldDefinition, work out how many bytes it
 * occupies. Used by the parser to lay out packed (offset-less) fields and to
 * bound range reads. Pure.
 */

import type { EnumEntry, FieldDefinition } from '../types/format';
import { getScalarType } from './DataTypes';

/** Bytes consumed by a field. Returns 0 for zero-length, throws on unknowable. */
export function computeFieldSize(field: FieldDefinition): number {
  const t = field.type;
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
      return each * (field.count ?? 0);
    }
    case 'struct': {
      const nested = (field.fields as FieldDefinition[]) ?? [];
      let end = 0;
      let cursor = 0;
      for (const f of nested) {
        const at = f.offset ?? cursor;
        const sz = computeFieldSize(f);
        end = Math.max(end, at + sz);
        cursor = at + sz;
      }
      return field.size ?? end;
    }
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
