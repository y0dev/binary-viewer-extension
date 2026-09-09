/**
 * Scalar data-type registry. Pure functions over a DataView; no I/O.
 *
 * Every reader receives a DataView positioned at the file window, a byte offset
 * *within that view*, and a littleEndian flag. `size` is the fixed width in
 * bytes. Values may be `number` or `bigint` (64-bit integers).
 */

export type ScalarValue = number | bigint | boolean;

export interface ScalarType {
  name: string;
  size: number;
  category: 'int' | 'float' | 'char' | 'bool';
  signed: boolean;
  read(view: DataView, offset: number, littleEndian: boolean): ScalarValue;
}

const defs: ScalarType[] = [
  { name: 'uint8', size: 1, category: 'int', signed: false, read: (v, o) => v.getUint8(o) },
  { name: 'int8', size: 1, category: 'int', signed: true, read: (v, o) => v.getInt8(o) },
  { name: 'uint16', size: 2, category: 'int', signed: false, read: (v, o, le) => v.getUint16(o, le) },
  { name: 'int16', size: 2, category: 'int', signed: true, read: (v, o, le) => v.getInt16(o, le) },
  { name: 'uint32', size: 4, category: 'int', signed: false, read: (v, o, le) => v.getUint32(o, le) },
  { name: 'int32', size: 4, category: 'int', signed: true, read: (v, o, le) => v.getInt32(o, le) },
  { name: 'uint64', size: 8, category: 'int', signed: false, read: (v, o, le) => v.getBigUint64(o, le) },
  { name: 'int64', size: 8, category: 'int', signed: true, read: (v, o, le) => v.getBigInt64(o, le) },
  { name: 'float32', size: 4, category: 'float', signed: true, read: (v, o, le) => v.getFloat32(o, le) },
  { name: 'float64', size: 8, category: 'float', signed: true, read: (v, o, le) => v.getFloat64(o, le) },
];

const registry = new Map<string, ScalarType>();
for (const d of defs) {
  registry.set(d.name, d);
}

// Aliases
registry.set('byte', registry.get('uint8')!);
registry.set('float', registry.get('float32')!);
registry.set('double', registry.get('float64')!);
registry.set('char', { ...registry.get('uint8')!, name: 'char', category: 'char' });
registry.set('bool', { name: 'bool', size: 1, category: 'bool', signed: false, read: (v, o) => v.getUint8(o) !== 0 });
registry.set('boolean', registry.get('bool')!);

export function getScalarType(name: string | undefined): ScalarType | undefined {
  return name === undefined ? undefined : registry.get(name);
}

export function isScalarType(name: string | undefined): boolean {
  return name === undefined ? false : registry.has(name);
}

export const SCALAR_TYPE_NAMES: string[] = defs.map((d) => d.name);

export const ALL_SCALAR_ALIASES: string[] = [...registry.keys()];

/** Format a scalar value for display given an optional display hint. */
export function formatScalar(
  value: ScalarValue,
  type: ScalarType,
  display: 'hex' | 'dec' | 'bin' | 'auto' = 'auto',
): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (type.category === 'char') {
    const code = Number(value);
    const ch = code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '.';
    return `'${ch}' (0x${code.toString(16).toUpperCase().padStart(2, '0')})`;
  }
  if (type.category === 'float') {
    const n = Number(value);
    return Number.isInteger(n) ? n.toFixed(1) : String(n);
  }
  // integers
  if (typeof value === 'bigint') {
    if (display === 'hex') {
      const unsigned = value < 0n ? value + (1n << BigInt(type.size * 8)) : value;
      return '0x' + unsigned.toString(16).toUpperCase().padStart(type.size * 2, '0');
    }
    if (display === 'bin') {
      const unsigned = value < 0n ? value + (1n << BigInt(type.size * 8)) : value;
      return '0b' + unsigned.toString(2).padStart(type.size * 8, '0');
    }
    return value.toString(10);
  }
  const num = value as number;
  if (display === 'hex') {
    const unsigned = num < 0 ? num >>> 0 : num;
    return '0x' + unsigned.toString(16).toUpperCase().padStart(type.size * 2, '0');
  }
  if (display === 'bin') {
    const unsigned = num < 0 ? num >>> 0 : num;
    return '0b' + unsigned.toString(2).padStart(type.size * 8, '0');
  }
  return num.toString(10);
}
