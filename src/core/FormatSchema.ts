/**
 * Declarative validation for FormatDefinition objects. No code execution — a
 * definition is plain data. This runs on import, on save from the editor, and
 * when loading from disk.
 */

import type { BitSpec, FieldDefinition, FormatDefinition, MagicSpec } from '../types/format';
import { isScalarType } from './DataTypes';
import { parseBitRange } from './BitField';
import { normalizeEndianness } from './Endianness';
import { computeFieldSize } from './BinaryField';
import { hasType, isBitFieldForm, isContainerForm, containerChildren } from './FieldShape';

const COMPOSITE_TYPES = new Set([
  'bytes',
  'hex',
  'binary',
  'ascii',
  'utf8',
  'utf16',
  'string',
  'enum',
  'flags',
  'bitfield',
  'timestamp',
  'struct',
  'array',
  'padding',
]);

export const COMPOSITE_TYPE_NAMES = [...COMPOSITE_TYPES];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function isKnownType(type: string | undefined): boolean {
  return type !== undefined && (isScalarType(type) || COMPOSITE_TYPES.has(type));
}

export function parseMagicBytes(spec: string): number[] {
  const tokens = spec
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  return tokens.map((tok) => {
    const t = tok.toLowerCase().replace(/^0x/, '');
    const n = parseInt(t, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xff || t.length > 2) {
      throw new Error(`Invalid magic byte token: "${tok}"`);
    }
    return n;
  });
}

function validateMagic(magic: MagicSpec, path: string, errors: string[]): void {
  if (typeof magic.offset !== 'number' || magic.offset < 0) {
    errors.push(`${path}.offset must be a non-negative number`);
  }
  if (typeof magic.bytes !== 'string' || magic.bytes.trim() === '') {
    errors.push(`${path}.bytes must be a non-empty hex string`);
    return;
  }
  try {
    const bytes = parseMagicBytes(magic.bytes);
    if (magic.mask !== undefined) {
      const mask = parseMagicBytes(magic.mask);
      if (mask.length !== bytes.length) {
        errors.push(`${path}.mask length (${mask.length}) must match bytes length (${bytes.length})`);
      }
    }
  } catch (e) {
    errors.push(`${path}: ${(e as Error).message}`);
  }
}

function validateBits(bits: BitSpec[], containerBytes: number, path: string, errors: string[]): void {
  const containerBits = containerBytes * 8;
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i];
    const bp = `${path}.fields[${i}]`;
    if (!b || typeof b.name !== 'string' || b.name === '') {
      errors.push(`${bp}.name is required`);
    }
    if (typeof b.bits !== 'string') {
      errors.push(`${bp}.bits is required (e.g. "0" or "1-3")`);
      continue;
    }
    try {
      const r = parseBitRange(b.bits);
      if (r.hi >= containerBits) {
        errors.push(`${bp}.bits range ${b.bits} exceeds container width ${containerBits} bits`);
      }
    } catch (e) {
      errors.push(`${bp}: ${(e as Error).message}`);
    }
  }
}

function isBitSpecArray(fields: FieldDefinition[] | BitSpec[] | undefined): fields is BitSpec[] {
  return Array.isArray(fields) && fields.length > 0 && 'bits' in (fields[0] as object);
}

function validateStructure(field: FieldDefinition, path: string, result: ValidationResult): void {
  const { errors } = result;
  const label = field.name ? `structure "${field.name}"` : 'structure';

  if (
    field.offset !== undefined &&
    (typeof field.offset !== 'number' || !Number.isInteger(field.offset) || field.offset < 0)
  ) {
    errors.push(`${cap(label)} has an invalid offset.`);
  }
  if (
    field.size !== undefined &&
    (typeof field.size !== 'number' || !Number.isInteger(field.size) || field.size < 0)
  ) {
    errors.push(`${cap(label)} has an invalid size.`);
  }
  if (field.endianness !== undefined && normalizeEndianness(field.endianness) === undefined) {
    errors.push(`${path}.endianness must be "little" or "big"`);
  }

  const children = containerChildren(field);
  if (children.length === 0) {
    errors.push(`${cap(label)} must contain at least one field.`);
    return;
  }

  children.forEach((child, i) => validateField(child, `${path}.fields[${i}]`, result));

  // Resolve each child's byte range (relative to this structure) for overlap
  // and size-overflow checks. Skip a child whose size cannot be determined.
  const ranges: { name: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (const child of children) {
    if (
      child.offset !== undefined &&
      (typeof child.offset !== 'number' || !Number.isInteger(child.offset) || child.offset < 0)
    ) {
      errors.push(`Field "${child.name}" has an invalid offset.`);
    }
    const start = typeof child.offset === 'number' && child.offset >= 0 ? child.offset : cursor;
    let sz: number | undefined;
    try {
      sz = computeFieldSize(child);
    } catch {
      sz = undefined;
    }
    if (sz !== undefined && Number.isFinite(sz)) {
      ranges.push({ name: child.name ?? `fields[${ranges.length}]`, start, end: start + sz });
      cursor = start + sz;
    } else {
      cursor = start;
    }
  }

  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i];
      const b = ranges[j];
      if (a.start < b.end && b.start < a.end) {
        errors.push(
          `${cap(label)} contains overlapping fields ("${a.name}" and "${b.name}").`,
        );
      }
    }
  }

  if (typeof field.size === 'number' && field.size >= 0) {
    for (const r of ranges) {
      if (r.end > field.size) {
        errors.push(
          `Field "${r.name}" extends beyond the declared size of ${label} (${field.size} bytes).`,
        );
      }
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function validateField(field: FieldDefinition, path: string, result: ValidationResult): void {
  const { errors, warnings } = result;
  if (!field || typeof field !== 'object') {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof field.name !== 'string' || field.name.trim() === '') {
    errors.push(`${path}.name is required`);
  }

  const typed = hasType(field);
  const bitForm = isBitFieldForm(field);
  const hasFieldsArray = Array.isArray(field.fields);
  const containerForm = isContainerForm(field);

  // A field must be exactly one of: primitive (type), nested structure (fields),
  // or the bit-field form (type + { bits } entries).
  if (typed && hasFieldsArray && !bitForm && field.type !== 'struct') {
    errors.push(
      `Field "${field.name}" declares both a type ("${field.type}") and nested fields. ` +
        `Define either a "type" or a "fields" array, not both.`,
    );
    return;
  }
  if (!typed && !containerForm && !bitForm) {
    errors.push(`Field "${field.name}" must define either a type or nested fields.`);
    return;
  }

  // ---- nested structure -------------------------------------------------
  if (containerForm) {
    validateStructure(field, path, result);
    return;
  }

  // ---- primitive / composite -----------------------------------------
  if (!isKnownType(field.type)) {
    errors.push(`${path}.type "${field.type}" is not a known type`);
  }
  if (field.offset !== undefined && (typeof field.offset !== 'number' || field.offset < 0 || !Number.isFinite(field.offset))) {
    errors.push(`${path}.offset must be a non-negative number`);
  }
  if (field.endianness !== undefined && normalizeEndianness(field.endianness) === undefined) {
    errors.push(`${path}.endianness must be "little" or "big"`);
  }

  const t = field.type;
  const needsLength = t === 'ascii' || t === 'utf8' || t === 'utf16' || t === 'string';
  const needsSize = t === 'bytes' || t === 'hex' || t === 'binary' || t === 'padding';

  if (needsLength && field.length === undefined && field.size === undefined) {
    errors.push(`${path}: string type "${t}" requires "length" (characters) or "size" (bytes)`);
  }
  if (needsSize && field.size === undefined && field.length === undefined) {
    errors.push(`${path}: type "${t}" requires "size" in bytes`);
  }
  if ((field.size !== undefined && (field.size < 0 || !Number.isInteger(field.size)))) {
    errors.push(`${path}.size must be a non-negative integer`);
  }

  if (t === 'array') {
    if (!field.items || typeof field.items !== 'object') {
      errors.push(`${path}: "array" requires "items" (element definition)`);
    } else {
      validateField({ ...field.items, name: field.items.name ?? 'item' }, `${path}.items`, result);
    }
    if (field.count === undefined || field.count < 0) {
      errors.push(`${path}: "array" requires a non-negative "count"`);
    }
  }

  const scalarWithBits = isScalarType(t) && isBitSpecArray(field.fields);
  if (t === 'flags' || t === 'bitfield' || scalarWithBits) {
    if (!isBitSpecArray(field.fields)) {
      errors.push(`${path}: "${t}" requires a "fields" array of { name, bits }`);
    } else {
      const containerBytes = field.size ?? scalarSizeGuess(field.type) ?? 1;
      validateBits(field.fields, containerBytes, path, errors);
    }
  }

  if (t === 'enum') {
    if (field.enum === undefined) {
      errors.push(`${path}: "enum" requires an "enum" mapping`);
    }
    if (field.size === undefined && !isScalarType(field.type)) {
      warnings.push(`${path}: "enum" without "size" defaults to 4 bytes`);
    }
  }

  if (field.scale !== undefined && typeof field.scale !== 'number') {
    errors.push(`${path}.scale must be a number`);
  }
}

function scalarSizeGuess(type: string | undefined): number | undefined {
  if (type === undefined) {
    return undefined;
  }
  const map: Record<string, number> = {
    uint8: 1, int8: 1, byte: 1, char: 1, bool: 1, boolean: 1,
    uint16: 2, int16: 2, utf16: 2,
    uint32: 4, int32: 4, float32: 4, float: 4,
    uint64: 8, int64: 8, float64: 8, double: 8,
  };
  return map[type];
}

export function validateFormat(input: unknown): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  const { errors } = result;

  if (!input || typeof input !== 'object') {
    errors.push('Format must be a JSON object');
    result.valid = false;
    return result;
  }
  const fmt = input as Partial<FormatDefinition>;

  if (typeof fmt.name !== 'string' || fmt.name.trim() === '') {
    errors.push('"name" is required and must be a non-empty string');
  }
  if (fmt.endianness !== undefined && normalizeEndianness(fmt.endianness) === undefined) {
    errors.push('"endianness" must be "little" or "big"');
  }
  if (fmt.fileExtensions !== undefined) {
    if (!Array.isArray(fmt.fileExtensions) || fmt.fileExtensions.some((x) => typeof x !== 'string')) {
      errors.push('"fileExtensions" must be an array of strings');
    }
  }
  if (fmt.magic !== undefined) {
    const list = Array.isArray(fmt.magic) ? fmt.magic : [fmt.magic];
    list.forEach((m, i) => validateMagic(m, `magic[${i}]`, errors));
  }

  const hasFields = Array.isArray(fmt.fields) && fmt.fields.length > 0;
  const hasSections = Array.isArray(fmt.sections) && fmt.sections.length > 0;

  if (fmt.fields !== undefined && !Array.isArray(fmt.fields)) {
    errors.push('"fields" must be an array');
  } else if (hasFields) {
    fmt.fields!.forEach((f, i) => validateField(f, `fields[${i}]`, result));
  }

  if (fmt.sections !== undefined) {
    validateSections(fmt.sections, result);
  }

  if (!hasFields && !hasSections) {
    errors.push('a format must define a non-empty "fields" array, a "sections" array, or both');
  }

  result.valid = errors.length === 0;
  return result;
}

const FLAGS_RE = /^[rwxa\- ]*$/i;

function validateSections(sections: unknown, result: ValidationResult): void {
  const { errors, warnings } = result;
  if (!Array.isArray(sections)) {
    errors.push('"sections" must be an array');
    return;
  }
  sections.forEach((raw, i) => {
    const path = `sections[${i}]`;
    if (!raw || typeof raw !== 'object') {
      errors.push(`${path} must be an object`);
      return;
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.name !== 'string' || s.name.trim() === '') {
      errors.push(`${path}.name is required`);
    }
    const start = normNumeric(s.start);
    if (start === undefined) {
      errors.push(`${path}.start must be a non-negative number or hex string (e.g. "0x8000")`);
    }
    const length = normNumeric(s.length);
    const end = normNumeric(s.end);
    if (length === undefined && end === undefined) {
      errors.push(`${path} must define "length" or "end"`);
    }
    if (length !== undefined && end !== undefined) {
      warnings.push(`${path}: both "length" and "end" set — "length" wins`);
    }
    if (end !== undefined && start !== undefined && end < start) {
      errors.push(`${path}.end (${end}) is before "start" (${start})`);
    }
    if (s.flags !== undefined && (typeof s.flags !== 'string' || !FLAGS_RE.test(s.flags))) {
      errors.push(`${path}.flags must be a string of r/w/x/a/- (e.g. "rwx", "r-x")`);
    }
    if (s.display !== undefined && typeof s.display !== 'boolean') {
      errors.push(`${path}.display must be true or false`);
    }
  });
}

function normNumeric(v: unknown): number | undefined {
  if (typeof v === 'number') {
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
  }
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    let n: number;
    if (t.startsWith('0x')) {
      n = parseInt(t.slice(2), 16);
    } else if (/^[0-9a-f]+h$/.test(t)) {
      n = parseInt(t.slice(0, -1), 16);
    } else if (/^\d+$/.test(t)) {
      n = parseInt(t, 10);
    } else {
      n = Number(t);
    }
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  }
  return undefined;
}
