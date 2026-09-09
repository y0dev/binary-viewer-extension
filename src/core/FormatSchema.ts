/**
 * Declarative validation for FormatDefinition objects. No code execution — a
 * definition is plain data. This runs on import, on save from the editor, and
 * when loading from disk.
 */

import type { BitSpec, FieldDefinition, FormatDefinition, MagicSpec } from '../types/format';
import { isScalarType } from './DataTypes';
import { parseBitRange } from './BitField';
import { normalizeEndianness } from './Endianness';

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

export function isKnownType(type: string): boolean {
  return isScalarType(type) || COMPOSITE_TYPES.has(type);
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

function validateField(field: FieldDefinition, path: string, result: ValidationResult): void {
  const { errors, warnings } = result;
  if (!field || typeof field !== 'object') {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof field.name !== 'string' || field.name.trim() === '') {
    errors.push(`${path}.name is required`);
  }
  if (typeof field.type !== 'string' || field.type.trim() === '') {
    errors.push(`${path}.type is required`);
    return;
  }
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

  if (t === 'struct') {
    const nested = field.fields as FieldDefinition[] | undefined;
    if (!Array.isArray(nested) || nested.length === 0) {
      errors.push(`${path}: "struct" requires a non-empty "fields" array`);
    } else {
      nested.forEach((f, i) => validateField(f, `${path}.fields[${i}]`, result));
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

function scalarSizeGuess(type: string): number | undefined {
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
  if (!Array.isArray(fmt.fields) || fmt.fields.length === 0) {
    errors.push('"fields" must be a non-empty array');
  } else {
    fmt.fields.forEach((f, i) => validateField(f, `fields[${i}]`, result));
  }

  result.valid = errors.length === 0;
  return result;
}
