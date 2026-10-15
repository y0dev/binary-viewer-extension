/**
 * Static byte layout of a format definition — the "expected layout" table shown
 * under the JSON preview in the format editor. It lays fields out the same way
 * the parser does (explicit `offset`, else packed after the previous sibling;
 * `offsetField` pointers live elsewhere in the file) but without reading any
 * bytes, so anything only known at parse time (cstring, countField arrays,
 * pointers) shows up with an unknown size / offset. Pure.
 */

import type { FieldDefinition, FormatDefinition, StructBody } from '../types/format';
import { computeFieldSize } from './BinaryField';
import { isBitFieldForm, isContainerForm, containerChildren } from './FieldShape';
import { expandShorthandField } from './FieldSyntax';

export interface LayoutRow {
  depth: number;
  /** Absolute byte offset, or null when it is a pointer (`offsetField`). */
  offset: number | null;
  /** True when an earlier unknown-size field makes this offset a lower bound. */
  approx: boolean;
  name: string;
  type: string;
  /** Bytes, or null when only known at parse time. */
  size: number | null;
  /** Extra detail: bit range, pointer source, dynamic count, … */
  note?: string;
  kind: 'field' | 'container' | 'bits';
}

export interface FormatLayout {
  rows: LayoutRow[];
  /** Highest in-band end offset (the static file size), or null if empty. */
  totalSize: number | null;
  /** True when some size/offset is only known at parse time. */
  dynamic: boolean;
  /** Size of each reusable `structures` entry (null = depends on parse-time data). */
  structs: { name: string; size: number | null; sizeAlign?: number }[];
}

const MAX_DEPTH = 24;
const MAX_ROWS = 2000;

export function buildLayout(def: FormatDefinition): FormatLayout {
  const table: Record<string, StructBody> = def.structures ?? {};
  const rows: LayoutRow[] = [];
  let dynamic = false;

  const sizeOrNull = (f: FieldDefinition): number | null => {
    try {
      return computeFieldSize(f);
    } catch {
      return null;
    }
  };

  /** Lay out `fields` relative to `base`; returns the in-band end (relative to base) and whether sizes stayed static. */
  function layFields(
    fields: FieldDefinition[],
    base: number,
    depth: number,
    approxIn: boolean,
    stack: string[],
  ): { end: number; approx: boolean } {
    let cursor = 0;
    let end = 0;
    let approx = approxIn;
    for (const raw of fields) {
      if (rows.length >= MAX_ROWS || depth > MAX_DEPTH) {
        break;
      }
      const f = expandShorthandField(raw);
      const isPointer = f.offset === undefined && !!f.offsetField;
      const rel = f.offset !== undefined ? f.offset : cursor;
      const abs: number | null = isPointer ? null : base + rel;
      const size = layOne(f, abs, depth, approx, stack);
      if (size === null) {
        approx = true;
        dynamic = true;
      }
      if (isPointer) {
        dynamic = true;
        continue;
      }
      cursor = rel + (size ?? 0);
      end = Math.max(end, cursor);
    }
    return { end, approx };
  }

  /** Emit the row(s) for one field; returns its size (null = unknown until parse time). */
  function layOne(
    f: FieldDefinition,
    abs: number | null,
    depth: number,
    approx: boolean,
    stack: string[],
  ): number | null {
    const name = f.name ?? '';
    const base = abs ?? 0;
    const common = { depth, offset: abs, approx, name };
    const ptrNote = abs === null ? `at offset in "${f.offsetField}"` : undefined;

    const refName =
      typeof f.type === 'string' && table[f.type] && !Array.isArray(f.fields) ? f.type : undefined;
    if (refName !== undefined || isContainerForm(f)) {
      const body = refName !== undefined ? table[refName] : undefined;
      if (refName !== undefined && stack.includes(refName)) {
        rows.push({ ...common, type: refName, size: null, note: 'recursive reference', kind: 'field' });
        return null;
      }
      const children = body ? ((body.fields ?? []) as FieldDefinition[]) : containerChildren(f);
      const row: LayoutRow = {
        ...common,
        type: refName ?? 'struct',
        size: null,
        note: ptrNote,
        kind: 'container',
      };
      rows.push(row);
      const inner = layFields(children, base, depth + 1, approx, refName ? [...stack, refName] : stack);
      const explicit = f.size ?? body?.size;
      const align = f.sizeAlign ?? body?.sizeAlign;
      let size = explicit ?? inner.end;
      if (explicit === undefined && align && align > 0) {
        size = Math.ceil(size / align) * align;
      }
      row.size = inner.approx && explicit === undefined ? null : size;
      return row.size;
    }

    if (isBitFieldForm(f)) {
      const size = sizeOrNull(f);
      rows.push({ ...common, type: String(f.type), size, note: ptrNote, kind: 'container' });
      for (const b of f.fields as { name: string; bits: string }[]) {
        rows.push({
          depth: depth + 1,
          offset: abs,
          approx,
          name: b.name,
          type: 'bits',
          size: null,
          note: `bits ${b.bits}`,
          kind: 'bits',
        });
      }
      return size;
    }

    if (f.type === 'array' && f.items) {
      const item = expandShorthandField({ ...f.items, name: f.items.name || 'item' });
      const count = f.count;
      const countLabel = count !== undefined ? String(count) : f.countField ? `← ${f.countField}` : '?';
      const itemIsStruct =
        (typeof item.type === 'string' && !!table[item.type]) || isContainerForm(item) || item.type === 'array';
      const row: LayoutRow = {
        ...common,
        type: `${item.type === 'array' ? 'array' : (item.type ?? 'struct')}[${countLabel}]`,
        size: null,
        note: ptrNote,
        kind: itemIsStruct ? 'container' : 'field',
      };
      rows.push(row);
      let each: number | null;
      if (itemIsStruct && (count === undefined || count > 0)) {
        // Show one element's internal layout; the rest repeat it.
        const mark = rows.length;
        each = layOne({ ...item, name: '[0]' }, abs, depth + 1, approx, stack);
        if (rows.length > mark) {
          rows[mark].offset = abs;
        }
      } else {
        each = sizeOrNull(item);
      }
      row.size = f.size ?? (each !== null && count !== undefined ? each * count : null);
      return row.size;
    }

    const size = sizeOrNull(f);
    rows.push({
      ...common,
      type: typeof f.type === 'string' ? f.type : '',
      size,
      note: ptrNote,
      kind: 'field',
    });
    return size;
  }

  const top = layFields((def.fields ?? []) as FieldDefinition[], 0, 0, false, []);
  const totalSize = rows.length ? top.end : null;
  const wasDynamic = dynamic;

  // Struct sizes: lay each body out on its own, then discard the scratch rows.
  const structs: FormatLayout['structs'] = [];
  const mark = rows.length;
  for (const [name, body] of Object.entries(table)) {
    const inner = layFields(((body?.fields ?? []) as FieldDefinition[]), 0, 0, false, [name]);
    let size: number | null = body?.size ?? inner.end;
    if (body?.size === undefined && body?.sizeAlign && body.sizeAlign > 0) {
      size = Math.ceil(size / body.sizeAlign) * body.sizeAlign;
    }
    if (body?.size === undefined && inner.approx) {
      size = null;
    }
    structs.push({ name, size, sizeAlign: body?.sizeAlign });
  }
  rows.length = mark;

  return { rows, totalSize, dynamic: wasDynamic, structs };
}
