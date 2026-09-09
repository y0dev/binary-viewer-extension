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
