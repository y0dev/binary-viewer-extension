import type { Endianness } from '../types/format';

export const DEFAULT_ENDIANNESS: Endianness = 'little';

export function isLittleEndian(e: Endianness | undefined, fallback: Endianness = DEFAULT_ENDIANNESS): boolean {
  return (e ?? fallback) === 'little';
}

export function normalizeEndianness(value: unknown): Endianness | undefined {
  if (value === 'little' || value === 'le' || value === 'lsb') {
    return 'little';
  }
  if (value === 'big' || value === 'be' || value === 'msb' || value === 'network') {
    return 'big';
  }
  return undefined;
}
