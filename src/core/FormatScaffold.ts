/**
 * Generates a *starter* format definition from a binary file or a byte
 * selection. The output is a valid skeleton the user is expected to refine by
 * hand — it never tries to guess a real struct layout. Pure (no I/O).
 *
 * The main use case is large repeating data: select the region, say how big one
 * record is, and get `{ type: "array", count: <computed>, items: <template> }`
 * instead of hand-writing thousands of fields.
 */

import type { FieldDefinition, FormatDefinition, Endianness } from '../types/format';
import { getScalarType } from './DataTypes';
import { byteHex } from './humanize';

export const SCAFFOLD_SCALARS = [
  'uint8',
  'int8',
  'uint16',
  'int16',
  'uint32',
  'int32',
  'uint64',
  'int64',
  'float32',
  'float64',
] as const;

function extOf(fileName: string): string | undefined {
  const i = fileName.lastIndexOf('.');
  if (i <= 0) {
    return undefined;
  }
  return fileName.slice(i).toLowerCase();
}

function magicField(header: Uint8Array, bytes: number): FieldDefinition {
  return { name: 'magic', type: 'bytes', offset: 0, size: Math.min(bytes, header.length || bytes) };
}

function magicSpec(header: Uint8Array, bytes: number): { offset: number; bytes: string } | undefined {
  const n = Math.min(bytes, header.length);
  if (n <= 0) {
    return undefined;
  }
  return {
    offset: 0,
    bytes: Array.from(header.subarray(0, n), byteHex).join(' '),
  };
}

function baseMeta(name: string, fileName: string): Pick<FormatDefinition, 'name' | 'description' | 'fileExtensions' | 'endianness'> {
  const ext = extOf(fileName);
  const meta: ReturnType<typeof baseMeta> = {
    name: name.trim() || 'Generated Format',
    description: `Scaffold generated from ${fileName}. Replace the placeholder fields with the real layout.`,
    endianness: 'little',
  };
  if (ext) {
    meta.fileExtensions = [ext];
  }
  return meta;
}

// ---------------------------------------------------------------------------

export interface WholeFileScaffoldOptions {
  name: string;
  fileName: string;
  fileSize: number;
  /** First bytes of the file, for the magic guess. May be empty. */
  header: Uint8Array;
  includeMagic: boolean;
  magicBytes?: number; // default 4
  endianness?: Endianness;
}

export function scaffoldWholeFile(opts: WholeFileScaffoldOptions): FormatDefinition {
  const magicLen = opts.magicBytes ?? 4;
  const def: FormatDefinition = {
    ...baseMeta(opts.name, opts.fileName),
    endianness: opts.endianness ?? 'little',
    fields: [],
  };

  if (opts.includeMagic) {
    const m = magicSpec(opts.header, magicLen);
    if (m) {
      def.magic = m;
    }
  }

  const fields: FieldDefinition[] = [];
  let cursor = 0;
  if (opts.includeMagic && opts.header.length > 0) {
    fields.push(magicField(opts.header, magicLen));
    cursor = Math.min(magicLen, opts.header.length);
  }

  const headerEnd = Math.min(opts.fileSize, cursor + 64);
  if (headerEnd > cursor) {
    fields.push({
      name: 'header',
      type: 'bytes',
      offset: cursor,
      size: headerEnd - cursor,
      description: 'TODO: split into real fields (uint32, uint16, flags, …)',
    });
    cursor = headerEnd;
  }

  if (opts.fileSize > cursor) {
    const bodyLen = Math.min(opts.fileSize - cursor, 4096);
    fields.push({
      name: 'body',
      type: 'bytes',
      offset: cursor,
      size: bodyLen,
      description:
        opts.fileSize - cursor > bodyLen
          ? `TODO: first ${bodyLen} of ${opts.fileSize - cursor} bytes — describe the payload / define an array`
          : 'TODO: describe the payload',
    });
  }

  def.fields = fields.length > 0 ? fields : [{ name: 'data', type: 'bytes', offset: 0, size: Math.min(opts.fileSize, 4096) }];
  return def;
}

// ---------------------------------------------------------------------------

export type ArrayElementKind =
  | { kind: 'scalar'; type: (typeof SCAFFOLD_SCALARS)[number] }
  | { kind: 'bytes'; recordSize: number }
  | { kind: 'struct'; recordSize: number };

export interface ArrayScaffoldOptions {
  name: string;
  fileName: string;
  /** Absolute offset where the array starts. */
  start: number;
  /** Total bytes the array spans (e.g. the selection length). */
  totalBytes: number;
  element: ArrayElementKind;
  endianness?: Endianness;
  /** Add a magic block + field from `header`. */
  includeMagic?: boolean;
  header?: Uint8Array;
  magicBytes?: number;
}

export interface ArrayScaffoldResult {
  format: FormatDefinition;
  elementSize: number;
  count: number;
  /** Bytes left over after `count` whole elements. */
  remainder: number;
}

export function scaffoldArray(opts: ArrayScaffoldOptions): ArrayScaffoldResult {
  const elementSize = resolveElementSize(opts.element);
  if (elementSize <= 0) {
    throw new Error('element size must be a positive integer');
  }
  const count = Math.floor(opts.totalBytes / elementSize);
  const remainder = opts.totalBytes - count * elementSize;

  const items = buildItems(opts.element);
  const arrayField: FieldDefinition = {
    name: 'records',
    type: 'array',
    offset: opts.start,
    count,
    items,
    description: `${count} x ${elementSize}-byte record${count === 1 ? '' : 's'} generated from a ${opts.totalBytes}-byte selection${
      remainder ? ` (${remainder} trailing byte${remainder === 1 ? '' : 's'} left over)` : ''
    }. Edit "items" once to decode every record.`,
  };

  const fields: FieldDefinition[] = [];
  if (opts.includeMagic && opts.header && opts.header.length > 0) {
    const magicLen = opts.magicBytes ?? 4;
    fields.push(magicField(opts.header, magicLen));
  }
  fields.push(arrayField);

  const format: FormatDefinition = {
    ...baseMeta(opts.name, opts.fileName),
    endianness: opts.endianness ?? 'little',
    fields,
  };
  if (opts.includeMagic && opts.header) {
    const m = magicSpec(opts.header, opts.magicBytes ?? 4);
    if (m) {
      format.magic = m;
    }
  }
  return { format, elementSize, count, remainder };
}

function resolveElementSize(el: ArrayElementKind): number {
  if (el.kind === 'scalar') {
    return getScalarType(el.type)?.size ?? 0;
  }
  return Math.floor(el.recordSize);
}

function buildItems(el: ArrayElementKind): FieldDefinition {
  if (el.kind === 'scalar') {
    return { name: 'value', type: el.type };
  }
  if (el.kind === 'bytes') {
    return { name: 'entry', type: 'bytes', size: Math.floor(el.recordSize) };
  }
  // struct template: one uint32 + the rest as opaque bytes, so it is valid and
  // obviously a "fill me in" stub.
  const size = Math.floor(el.recordSize);
  const nested: FieldDefinition[] = [{ name: 'field0', type: 'uint32', offset: 0, description: 'TODO' }];
  if (size > 4) {
    nested.push({ name: 'rest', type: 'bytes', offset: 4, size: size - 4, description: 'TODO: split into fields' });
  }
  return { name: 'record', fields: nested };
}

// ---------------------------------------------------------------------------

export interface SingleFieldScaffoldOptions {
  name: string;
  fileName: string;
  start: number;
  size: number;
  /** A scalar name, or 'bytes' / 'ascii'. */
  type: string;
  endianness?: Endianness;
}

export function scaffoldSingleField(opts: SingleFieldScaffoldOptions): FormatDefinition {
  const field: FieldDefinition = { name: 'value', type: opts.type, offset: opts.start };
  const scalar = getScalarType(opts.type);
  if (!scalar) {
    // bytes / ascii / etc. need an explicit length
    if (opts.type === 'ascii' || opts.type === 'utf8' || opts.type === 'string') {
      field.length = opts.size;
    } else {
      field.size = opts.size;
    }
  }
  return {
    ...baseMeta(opts.name, opts.fileName),
    endianness: opts.endianness ?? 'little',
    fields: [field],
  };
}

/** A "nice" record size that divides `total`, for the element-size prompt default. */
export function suggestElementSize(total: number): number {
  for (const n of [16, 8, 4, 32, 24, 12, 64, 2, 1]) {
    if (total % n === 0 && n <= total) {
      return n;
    }
  }
  return Math.min(16, Math.max(1, total));
}
