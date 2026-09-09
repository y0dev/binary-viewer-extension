import { bigintHex } from '../core/humanize';

export interface Interp {
  label: string;
  value: string;
  /** true when there were not enough bytes to compute this. */
  missing?: boolean;
}

export function describeByte(b: number): Interp[] {
  const int8 = b < 128 ? b : b - 256;
  return [
    { label: 'Hex', value: b.toString(16).toUpperCase().padStart(2, '0') },
    { label: 'Binary', value: b.toString(2).padStart(8, '0') },
    { label: 'Octal', value: '0o' + b.toString(8).padStart(3, '0') },
    { label: 'Unsigned (uint8)', value: String(b) },
    { label: 'Signed (int8)', value: String(int8) },
    { label: 'ASCII', value: b >= 0x20 && b <= 0x7e ? `'${String.fromCharCode(b)}'` : '(non-printable)' },
  ];
}

/**
 * Interpret up to 8 bytes as the standard scalar types with the given
 * endianness. `avail` is how many of the bytes are real (the rest are padding
 * past EOF and produce `missing: true`).
 */
export function interpretScalars(bytes: Uint8Array, littleEndian: boolean, avail: number): Interp[] {
  const buf = new Uint8Array(8);
  buf.set(bytes.subarray(0, 8));
  const dv = new DataView(buf.buffer);
  const out: Interp[] = [];
  const need = (n: number, produce: () => string): Interp => {
    if (avail < n) {
      return { label: '', value: '', missing: true };
    }
    return { label: '', value: produce() };
  };
  const push = (label: string, n: number, produce: () => string) => {
    const r = need(n, produce);
    r.label = label;
    out.push(r);
  };

  push('int8', 1, () => String(dv.getInt8(0)));
  push('uint8', 1, () => String(dv.getUint8(0)));
  push('int16', 2, () => String(dv.getInt16(0, littleEndian)));
  push('uint16', 2, () => String(dv.getUint16(0, littleEndian)));
  push('int32', 4, () => String(dv.getInt32(0, littleEndian)));
  push('uint32', 4, () => {
    const v = dv.getUint32(0, littleEndian);
    return `${v}  (0x${v.toString(16).toUpperCase().padStart(8, '0')})`;
  });
  push('int64', 8, () => dv.getBigInt64(0, littleEndian).toString());
  push('uint64', 8, () => {
    const v = dv.getBigUint64(0, littleEndian);
    return `${v.toString()}  (${bigintHex(v, 8)})`;
  });
  push('float32', 4, () => {
    const v = dv.getFloat32(0, littleEndian);
    return Number.isFinite(v) ? String(v) : String(v);
  });
  push('float64', 8, () => String(dv.getFloat64(0, littleEndian)));
  return out;
}
