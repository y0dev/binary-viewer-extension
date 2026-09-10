/** Formatting helpers shared by host and webview. Pure, no I/O. */

export function toHex(value: number, padBytes = 0): string {
  if (value < 0) {
    value = value >>> 0;
  }
  const s = value.toString(16).toUpperCase();
  return padBytes > 0 ? s.padStart(padBytes * 2, '0') : s;
}

export function offsetHex(offset: number): string {
  // 8 hex digits covers files up to 4 GiB; widen automatically beyond that.
  const digits = offset > 0xffffffff ? 16 : 8;
  return '0x' + offset.toString(16).toUpperCase().padStart(digits, '0');
}

export function byteHex(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Hex for a run of bytes shown as one word. With `littleEndian` the byte order
 * is reversed so the value reads most-significant digit first — a little-endian
 * `01 00 00 00` displays as `00000001`. `null` entries render as `--`.
 */
export function groupHexDisplay(bytes: ReadonlyArray<number | null>, littleEndian: boolean): string {
  const pairs = bytes.map((b) => (b === null ? '--' : byteHex(b)));
  if (littleEndian) {
    pairs.reverse();
  }
  return pairs.join('');
}

/**
 * How the raw hex view groups bytes into words. Raw-view only — it does not
 * affect the structure decoder or the inspector.
 *   '1'   — plain bytes (default)
 *   '2le' — 16-bit words, little-endian bytes reversed for a numeric read
 *   '4be' — 32-bit words, kept in file order
 *   …and so on for 2 / 4 / 8 bytes × le / be.
 */
export type ByteGroupMode = '1' | '2le' | '2be' | '4le' | '4be' | '8le' | '8be';

export const BYTE_GROUP_MODES: ByteGroupMode[] = ['1', '2le', '2be', '4le', '4be', '8le', '8be'];

export function parseByteGroup(mode: string | undefined): { bytes: 1 | 2 | 4 | 8; le: boolean } {
  switch (mode) {
    case '2le':
      return { bytes: 2, le: true };
    case '2be':
      return { bytes: 2, le: false };
    case '4le':
      return { bytes: 4, le: true };
    case '4be':
      return { bytes: 4, le: false };
    case '8le':
      return { bytes: 8, le: true };
    case '8be':
      return { bytes: 8, le: false };
    default:
      return { bytes: 1, le: false };
  }
}

export function byteBits(b: number): string {
  return b.toString(2).padStart(8, '0');
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[i]}`;
}

/** Printable ASCII -> the character; everything else -> '.'. */
export function asciiChar(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
}

export function parseNumericInput(input: string): number | undefined {
  const t = input.trim().toLowerCase();
  if (t === '') {
    return undefined;
  }
  let n: number;
  if (t.startsWith('0x')) {
    n = parseInt(t.slice(2), 16);
  } else if (t.startsWith('0b')) {
    n = parseInt(t.slice(2), 2);
  } else if (/^[0-9a-f]+h$/.test(t)) {
    n = parseInt(t.slice(0, -1), 16);
  } else if (/^\d+$/.test(t)) {
    n = parseInt(t, 10);
  } else if (/^[0-9a-f]+$/.test(t) && /[a-f]/.test(t)) {
    // bare hex containing a-f digits
    n = parseInt(t, 16);
  } else {
    n = Number(t);
  }
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * Resolve a base-address value (a number, or a "0x…"/decimal/"…h" string) to a
 * non-negative integer. Returns 0 for empty / invalid input.
 */
export function resolveBaseAddress(input: number | string | undefined): number {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? Math.floor(input) : 0;
  }
  if (typeof input === 'string') {
    return parseNumericInput(input) ?? 0;
  }
  return 0;
}

/** Convert a bigint to a 0x-prefixed, byte-padded hex string. */
export function bigintHex(value: bigint, bytes: number): string {
  const unsigned = value < 0n ? value + (1n << BigInt(bytes * 8)) : value;
  return '0x' + unsigned.toString(16).toUpperCase().padStart(bytes * 2, '0');
}
