/**
 * Declarative binary structure parser.
 *
 * Input: a validated FormatDefinition + a byte window that already covers the
 * region the format describes. Output: a flat list of render-ready ParsedNode
 * objects (with depth for tree rendering). Pure — no I/O, no code execution.
 */

import type {
  FieldDefinition,
  FormatDefinition,
  BitSpec,
  Endianness,
  TimestampEpoch,
} from '../types/format';
import type { ParsedNode, ParsedBit } from '../types/messages';
import { formatScalar, getScalarType } from './DataTypes';
import { computeFieldSize, computeStructSize, lookupEnumLabel } from './BinaryField';
import { decodeBits } from './BitField';
import { isContainerForm, containerChildren } from './FieldShape';
import { expandShorthandField } from './FieldSyntax';
import { byteBits, byteHex, offsetHex, bigintHex } from './humanize';

export interface ByteWindow {
  /** Absolute file offset of bytes[0]. */
  baseOffset: number;
  bytes: Uint8Array;
  fileSize: number;
}

export interface TimestampDefaults {
  /** Epoch used for `timestamp` fields with no explicit `epoch`. Default 'unix'. */
  epoch?: TimestampEpoch;
  /** Render as a UTC ISO string (default) or the host's local time. */
  utc?: boolean;
}

export interface ParseOptions {
  defaultEndianness: Endianness;
  /** Safety cap on total emitted nodes (protects the webview from huge arrays). */
  maxNodes?: number;
  /** Max elements rendered per `array` field before a "… N more" summary row. 0 = no cap. */
  maxArrayElements?: number;
  /** Fallbacks for `timestamp` fields. */
  timestamp?: TimestampDefaults;
}

interface Ctx {
  win: ByteWindow;
  view: DataView;
  defEndian: Endianness;
  nodes: ParsedNode[];
  maxNodes: number;
  maxArrayElements: number;
  timestamp: TimestampDefaults;
  idSeq: number;
  /** Stack of enclosing containers; the last entry is the current parent. */
  stack: Array<{ id: string | null; path: string[] }>;
}

const DEFAULT_ARRAY_CAP = 4096;

/** Milliseconds from the JS epoch to the start of a named epoch. */
export function epochOffsetMs(epoch: TimestampEpoch | number | undefined): number {
  if (typeof epoch === 'number') {
    return epoch;
  }
  switch (epoch) {
    case 'y2k':
      return Date.UTC(2000, 0, 1);
    case 'gps':
      return Date.UTC(1980, 0, 6);
    case 'mac':
      return Date.UTC(1904, 0, 1);
    case 'filetime':
      return Date.UTC(1601, 0, 1);
    case 'unix':
    default:
      return 0;
  }
}

/** True when [abs, abs+size) lies fully inside the loaded window. */
function inWindow(ctx: Ctx, abs: number, size: number): boolean {
  const start = abs - ctx.win.baseOffset;
  return start >= 0 && start + size <= ctx.win.bytes.byteLength;
}

/**
 * Index to pass to `ctx.view` (a DataView already anchored at
 * `bytes.byteOffset`), so this is purely window-relative.
 */
function localOffset(ctx: Ctx, abs: number): number {
  return abs - ctx.win.baseOffset;
}

function slice(ctx: Ctx, abs: number, size: number): Uint8Array {
  const start = abs - ctx.win.baseOffset;
  return ctx.win.bytes.subarray(start, start + size);
}

export function parseFormat(
  format: FormatDefinition,
  win: ByteWindow,
  opts: ParseOptions,
): { nodes: ParsedNode[]; error?: string } {
  const ctx: Ctx = {
    win,
    view: new DataView(win.bytes.buffer, win.bytes.byteOffset, win.bytes.byteLength),
    defEndian: format.endianness ?? opts.defaultEndianness,
    nodes: [],
    maxNodes: opts.maxNodes ?? 20000,
    maxArrayElements:
      opts.maxArrayElements === undefined
        ? DEFAULT_ARRAY_CAP
        : opts.maxArrayElements <= 0
          ? Number.POSITIVE_INFINITY
          : opts.maxArrayElements,
    timestamp: opts.timestamp ?? {},
    idSeq: 0,
    stack: [{ id: null, path: [] }],
  };

  let cursor = 0;
  try {
    for (const field of format.fields ?? []) {
      if (ctx.nodes.length >= ctx.maxNodes) {
        return { nodes: ctx.nodes, error: 'Structure truncated: too many fields' };
      }
      const abs = field.offset ?? cursor;
      const size = parseField(ctx, field, abs, 0);
      cursor = abs + size;
    }
  } catch (e) {
    return { nodes: ctx.nodes, error: (e as Error).message };
  }
  return { nodes: ctx.nodes };
}

function pushNode(ctx: Ctx, node: Omit<ParsedNode, 'id'>): ParsedNode {
  const parent = ctx.stack[ctx.stack.length - 1];
  const full: ParsedNode = {
    id: `n${ctx.idSeq++}`,
    parentId: parent.id,
    path: [...parent.path, node.name],
    ...node,
  };
  ctx.nodes.push(full);
  return full;
}

function fieldEndianLittle(ctx: Ctx, field: FieldDefinition): boolean {
  return (field.endianness ?? ctx.defEndian) === 'little';
}

function parseField(ctx: Ctx, rawField: FieldDefinition, abs: number, depth: number): number {
  // Normalise "float32[8]"-style shorthand (a no-op for other types).
  const field = expandShorthandField(rawField);
  const t = field.type;

  // A field with nested `fields` and no scalar type is a nested structure.
  // (`type: "struct"` is also accepted for backward compatibility.)
  if (isContainerForm(field)) {
    return parseStruct(ctx, field, abs, depth);
  }

  // An integer scalar that carries a `fields` array of bit specs is a bit-field
  // container (the section-7 `{ "type": "uint8", "fields": [ { bits } ] }` form).
  if (
    getScalarType(t) &&
    Array.isArray(field.fields) &&
    field.fields.length > 0 &&
    typeof (field.fields[0] as { bits?: unknown }).bits === 'string'
  ) {
    return parseFlags(ctx, field, abs, depth);
  }

  // Composite dispatch first.
  switch (t) {
    case 'struct':
      return parseStruct(ctx, field, abs, depth);
    case 'array':
      return parseArray(ctx, field, abs, depth);
    case 'flags':
    case 'bitfield':
      return parseFlags(ctx, field, abs, depth);
    case 'enum':
      return parseEnum(ctx, field, abs, depth);
    case 'ascii':
    case 'utf8':
    case 'utf16':
    case 'string':
      return parseString(ctx, field, abs, depth);
    case 'bytes':
    case 'hex':
      return parseBytes(ctx, field, abs, depth, 'hex');
    case 'binary':
      return parseBytes(ctx, field, abs, depth, 'bits');
    case 'timestamp':
      return parseTimestamp(ctx, field, abs, depth);
    case 'padding': {
      const size = computeFieldSize(field);
      pushNode(ctx, {
        name: field.name || '(padding)',
        typeLabel: `padding[${size}]`,
        offset: abs,
        size,
        value: '…',
        depth,
        detail: field.description,
      });
      return size;
    }
    default:
      break;
  }

  // A `char` with a length/count is a fixed ASCII array (char[N]).
  if (t === 'char' && (field.length !== undefined || field.count !== undefined)) {
    return parseString(
      ctx,
      { ...field, type: 'ascii', length: field.length ?? field.count },
      abs,
      depth,
    );
  }

  // Scalar.
  const scalar = getScalarType(t);
  if (!scalar) {
    pushNode(ctx, {
      name: field.name,
      typeLabel: t ?? '(none)',
      offset: abs,
      size: 0,
      value: '',
      depth,
      error: t ? `unknown type "${t}"` : 'field must define either a type or nested fields',
    });
    return 0;
  }
  const size = field.size ?? scalar.size;
  if (!inWindow(ctx, abs, size)) {
    pushNode(ctx, {
      name: field.name,
      typeLabel: scalar.name,
      offset: abs,
      size,
      value: '',
      depth,
      error: abs + size > ctx.win.fileSize ? 'reads past end of file' : 'outside loaded window',
    });
    return size;
  }
  const le = fieldEndianLittle(ctx, field);
  const raw = scalar.read(ctx.view, localOffset(ctx, abs), le);

  let value: string;
  let detail: string;
  if (field.enum !== undefined && typeof raw !== 'boolean') {
    const label = lookupEnumLabel(field.enum, raw);
    value = label ? `${label} (${raw.toString()})` : raw.toString();
    detail = describeScalar(raw, scalar.size, scalar.category);
  } else if (typeof raw === 'number' && (field.scale !== undefined || field.bias !== undefined)) {
    const scaled = raw * (field.scale ?? 1) + (field.bias ?? 0);
    value = `${trimNum(scaled)}${field.unit ? ' ' + field.unit : ''}`;
    detail = `raw ${raw} · ${describeScalar(raw, scalar.size, scalar.category)}`;
  } else {
    value = formatScalar(raw, scalar, field.display ?? 'auto');
    if (field.unit) {
      value += ' ' + field.unit;
    }
    detail = describeScalar(raw, scalar.size, scalar.category);
  }

  pushNode(ctx, {
    name: field.name,
    typeLabel: scalar.name + (field.endianness ? ` (${field.endianness === 'little' ? 'LE' : 'BE'})` : ''),
    offset: abs,
    size,
    value,
    detail: field.description ? `${field.description} — ${detail}` : detail,
    depth,
    numericValue: typeof raw === 'number' && scalar.category === 'int' ? raw : undefined,
  });
  return size;
}

/**
 * Resolve an `array` field's element count: an explicit `count` wins; otherwise
 * `countField` names an earlier integer field whose decoded value is used.
 * Returns `null` when `countField` is set but no such field was parsed.
 */
function resolveArrayCount(ctx: Ctx, field: FieldDefinition): number | null {
  if (field.count !== undefined) {
    return Math.max(0, Math.floor(field.count));
  }
  if (field.countField) {
    for (let i = ctx.nodes.length - 1; i >= 0; i--) {
      const n = ctx.nodes[i];
      if (n.name === field.countField && typeof n.numericValue === 'number') {
        return Math.max(0, Math.floor(n.numericValue));
      }
    }
    return null;
  }
  return 0;
}

function describeScalar(raw: number | bigint | boolean, sizeBytes: number, category: string): string {
  if (typeof raw === 'boolean') {
    return raw ? 'true' : 'false';
  }
  if (category === 'float') {
    return `float ${trimNum(Number(raw))}`;
  }
  if (typeof raw === 'bigint') {
    const unsigned = raw < 0n ? raw + (1n << BigInt(sizeBytes * 8)) : raw;
    return `${raw.toString()} · ${bigintHex(unsigned, sizeBytes)}`;
  }
  const unsigned = raw < 0 ? raw >>> 0 : raw;
  const hex = '0x' + unsigned.toString(16).toUpperCase().padStart(sizeBytes * 2, '0');
  return `${raw} · ${hex}`;
}

function trimNum(n: number): string {
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return parseFloat(n.toFixed(6)).toString();
}

function parseStruct(ctx: Ctx, field: FieldDefinition, abs: number, depth: number): number {
  const nested = containerChildren(field);
  const size = computeStructSize(field);
  const node = pushNode(ctx, {
    name: field.name,
    typeLabel: 'struct',
    offset: abs,
    size,
    value: `${size} byte${size === 1 ? '' : 's'}`,
    detail: field.description,
    depth,
    isContainer: true,
  });
  if (!inWindow(ctx, abs, Math.min(size, 1)) && size > 0) {
    node.error = abs >= ctx.win.fileSize ? 'starts past end of file' : 'outside loaded window';
  }
  // Child offsets are RELATIVE to this structure; convert to absolute here.
  ctx.stack.push({ id: node.id, path: node.path! });
  let cursor = 0;
  for (const f of nested) {
    if (ctx.nodes.length >= ctx.maxNodes) {
      break;
    }
    const rel = f.offset ?? cursor;
    const csize = parseField(ctx, f, abs + rel, depth + 1);
    cursor = rel + csize;
  }
  ctx.stack.pop();
  return size;
}

function parseArray(ctx: Ctx, field: FieldDefinition, abs: number, depth: number): number {
  const item = field.items!;
  const resolved = resolveArrayCount(ctx, field);
  const count = resolved ?? 0;
  const countErr =
    resolved === null ? `count field "${field.countField}" not found before this array` : undefined;
  const each = computeFieldSize({ ...item, name: item.name || 'item' });
  const size = field.size ?? each * count;
  const via = field.count === undefined && field.countField ? ` ← ${field.countField}` : '';
  const node = pushNode(ctx, {
    name: field.name,
    typeLabel: `${item.type ?? 'struct'}[${count}${via}]`,
    offset: abs,
    size,
    value: `${count} element${count === 1 ? '' : 's'}`,
    detail: field.description,
    depth,
    isContainer: true,
    error: countErr,
  });
  ctx.stack.push({ id: node.id, path: node.path! });
  const limit = Math.min(count, ctx.maxArrayElements);
  for (let i = 0; i < limit; i++) {
    if (ctx.nodes.length >= ctx.maxNodes) {
      break;
    }
    parseField(ctx, { ...item, name: `${field.name}[${i}]`, offset: undefined }, abs + i * each, depth + 1);
  }
  if (limit < count) {
    pushNode(ctx, {
      name: `${field.name}[…]`,
      typeLabel: '',
      offset: abs + limit * each,
      size: 0,
      value:
        `… ${count - limit} more element${count - limit === 1 ? '' : 's'} not shown ` +
        `(raise binaryViewer.structure.maxArrayElements)`,
      depth: depth + 1,
    });
  }
  ctx.stack.pop();
  return size;
}

function readContainer(ctx: Ctx, abs: number, sizeBytes: number, le: boolean): number | bigint {
  const o = localOffset(ctx, abs);
  switch (sizeBytes) {
    case 1:
      return ctx.view.getUint8(o);
    case 2:
      return ctx.view.getUint16(o, le);
    case 4:
      return ctx.view.getUint32(o, le);
    case 8:
      return ctx.view.getBigUint64(o, le);
    default: {
      // arbitrary width, build from bytes
      let acc = 0n;
      for (let i = 0; i < sizeBytes; i++) {
        const b = BigInt(ctx.view.getUint8(o + (le ? sizeBytes - 1 - i : i)));
        acc = (acc << 8n) | b;
      }
      return acc <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(acc) : acc;
    }
  }
}

function parseFlags(ctx: Ctx, field: FieldDefinition, abs: number, depth: number): number {
  const sizeBytes = field.size ?? sizeFromScalar(field.type) ?? 1;
  if (!inWindow(ctx, abs, sizeBytes)) {
    pushNode(ctx, { name: field.name, typeLabel: `flags[${sizeBytes}]`, offset: abs, size: sizeBytes, value: '', depth, error: 'outside loaded window' });
    return sizeBytes;
  }
  const le = fieldEndianLittle(ctx, field);
  const container = readContainer(ctx, abs, sizeBytes, le);
  const specs = (field.fields as BitSpec[]) ?? [];
  const decoded = decodeBits(container, specs);
  const bits: ParsedBit[] = decoded.map((d) => ({
    name: d.name,
    bitLabel: d.range.width === 1 ? String(d.range.lo) : `${d.range.hi}-${d.range.lo}`,
    value: d.display,
  }));
  // add descriptions
  specs.forEach((s, i) => {
    if (bits[i] && s.description) {
      bits[i].description = s.description;
    }
  });

  const containerHex =
    typeof container === 'bigint'
      ? bigintHex(container, sizeBytes)
      : '0x' + container.toString(16).toUpperCase().padStart(sizeBytes * 2, '0');
  const binStr =
    typeof container === 'bigint'
      ? container.toString(2).padStart(sizeBytes * 8, '0')
      : container.toString(2).padStart(sizeBytes * 8, '0');

  pushNode(ctx, {
    name: field.name,
    typeLabel: `flags[${sizeBytes}]`,
    offset: abs,
    size: sizeBytes,
    value: `${containerHex}  ${binStr}`,
    detail: field.description,
    depth,
    bits,
  });
  return sizeBytes;
}

function sizeFromScalar(type: string | undefined): number | undefined {
  const s = getScalarType(type);
  return s?.size;
}

function parseEnum(ctx: Ctx, field: FieldDefinition, abs: number, depth: number): number {
  const sizeBytes = field.size ?? sizeFromScalar(field.type) ?? 4;
  if (!inWindow(ctx, abs, sizeBytes)) {
    pushNode(ctx, { name: field.name, typeLabel: `enum[${sizeBytes}]`, offset: abs, size: sizeBytes, value: '', depth, error: 'outside loaded window' });
    return sizeBytes;
  }
  const le = fieldEndianLittle(ctx, field);
  const raw = readContainer(ctx, abs, sizeBytes, le);
  const label = lookupEnumLabel(field.enum, raw);
  const rawHex =
    typeof raw === 'bigint'
      ? bigintHex(raw, sizeBytes)
      : '0x' + raw.toString(16).toUpperCase().padStart(sizeBytes * 2, '0');
  pushNode(ctx, {
    name: field.name,
    typeLabel: `enum`,
    offset: abs,
    size: sizeBytes,
    value: label ? `${label} (${raw.toString()})` : `${raw.toString()} (unknown)`,
    detail: field.description ? `${field.description} — ${rawHex}` : rawHex,
    depth,
    numericValue: typeof raw === 'number' ? raw : undefined,
  });
  return sizeBytes;
}

function parseString(ctx: Ctx, field: FieldDefinition, abs: number, depth: number): number {
  const t = field.type ?? 'ascii';
  const units = field.length ?? field.size ?? 0;
  const size = t === 'utf16' ? (field.size ?? units * 2) : (field.size ?? units);
  if (!inWindow(ctx, abs, size)) {
    pushNode(ctx, { name: field.name, typeLabel: t, offset: abs, size, value: '', depth, error: 'outside loaded window' });
    return size;
  }
  const raw = slice(ctx, abs, size);
  let text: string;
  try {
    if (t === 'utf16') {
      const le = fieldEndianLittle(ctx, field);
      text = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(raw);
    } else if (t === 'utf8') {
      text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
    } else {
      // ascii / string: byte-per-char, non-printable shown as .
      text = Array.from(raw, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : b === 0 ? '' : '.')).join('');
    }
  } catch {
    text = '(decode error)';
  }
  const nulChar = String.fromCharCode(0);
  const nul = text.indexOf(nulChar);
  const shown = (nul >= 0 ? text.slice(0, nul) : text).replace(/\r?\n/g, '\\n');
  pushNode(ctx, {
    name: field.name,
    typeLabel: `${t}[${units || size}]`,
    offset: abs,
    size,
    value: JSON.stringify(shown),
    detail: field.description,
    depth,
  });
  return size;
}

function parseBytes(
  ctx: Ctx,
  field: FieldDefinition,
  abs: number,
  depth: number,
  mode: 'hex' | 'bits',
): number {
  const size = computeFieldSize(field);
  if (!inWindow(ctx, abs, size)) {
    pushNode(ctx, { name: field.name, typeLabel: mode === 'hex' ? `bytes[${size}]` : `binary[${size}]`, offset: abs, size, value: '', depth, error: 'outside loaded window' });
    return size;
  }
  const raw = slice(ctx, abs, size);
  const MAX = 64;
  const shown = Array.from(raw.subarray(0, MAX), mode === 'hex' ? byteHex : byteBits).join(' ');
  const value = raw.length > MAX ? `${shown} … (+${raw.length - MAX} bytes)` : shown;
  pushNode(ctx, {
    name: field.name,
    typeLabel: mode === 'hex' ? `bytes[${size}]` : `binary[${size}]`,
    offset: abs,
    size,
    value,
    detail: field.description,
    depth,
  });
  return size;
}

function parseTimestamp(ctx: Ctx, field: FieldDefinition, abs: number, depth: number): number {
  const cfg = field.timestamp ?? {};
  const sizeBytes = cfg.size ?? 4;
  if (!inWindow(ctx, abs, sizeBytes)) {
    pushNode(ctx, { name: field.name, typeLabel: 'timestamp', offset: abs, size: sizeBytes, value: '', depth, error: 'outside loaded window' });
    return sizeBytes;
  }
  const le = fieldEndianLittle(ctx, field);
  const raw = readContainer(ctx, abs, sizeBytes, le);
  const rawNum = typeof raw === 'bigint' ? Number(raw) : raw;
  const epoch = cfg.epoch ?? ctx.timestamp.epoch ?? 'unix';
  const epochMs = epochOffsetMs(epoch);
  // FILETIME counts 100-ns ticks; everything else is seconds unless unit === 'ms'.
  const unitMs = epoch === 'filetime' ? 1e-4 : cfg.unit === 'ms' ? 1 : 1000;
  const date = new Date(epochMs + rawNum * unitMs);
  const utc = ctx.timestamp.utc ?? true;
  const shown = !Number.isFinite(date.getTime())
    ? '(invalid)'
    : utc
      ? date.toISOString()
      : date.toLocaleString();
  pushNode(ctx, {
    name: field.name,
    typeLabel: `timestamp`,
    offset: abs,
    size: sizeBytes,
    value: shown,
    detail: field.description ? `${field.description} — raw ${raw.toString()}` : `raw ${raw.toString()} @ ${offsetHex(abs)}`,
    depth,
  });
  return sizeBytes;
}
