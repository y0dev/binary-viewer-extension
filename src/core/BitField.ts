/**
 * Bit-field extraction. LSB is bit 0. A spec is either a single bit ("4") or an
 * inclusive range ("1-3" / "3-1", order-insensitive).
 */

import type { BitSpec } from '../types/format';

export interface BitRange {
  /** Low bit index, inclusive. */
  lo: number;
  /** High bit index, inclusive. */
  hi: number;
  width: number;
}

export function parseBitRange(spec: string): BitRange {
  const t = spec.trim();
  const m = /^(\d+)\s*(?:[-:]\s*(\d+))?$/.exec(t);
  if (!m) {
    throw new Error(`Invalid bit spec: "${spec}" (expected "N" or "N-M")`);
  }
  const a = parseInt(m[1], 10);
  const b = m[2] !== undefined ? parseInt(m[2], 10) : a;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { lo, hi, width: hi - lo + 1 };
}

/**
 * Validate a set of bit specs against a container width (in bits).
 * Returns a list of human-readable problems (empty === valid).
 */
export function validateBitSpecs(specs: BitSpec[], containerBits: number): string[] {
  const errors: string[] = [];
  const used = new Array<string | null>(containerBits).fill(null);
  for (const s of specs) {
    let range: BitRange;
    try {
      range = parseBitRange(s.bits);
    } catch (e) {
      errors.push((e as Error).message);
      continue;
    }
    if (range.hi >= containerBits) {
      errors.push(`Field "${s.name}" bit ${range.hi} exceeds container width ${containerBits}`);
      continue;
    }
    for (let i = range.lo; i <= range.hi; i++) {
      if (used[i]) {
        errors.push(`Field "${s.name}" overlaps "${used[i]}" at bit ${i}`);
      } else {
        used[i] = s.name;
      }
    }
  }
  return errors;
}

/** Extract the unsigned integer value of a bit range from a container value. */
export function extractBits(container: number | bigint, range: BitRange): number | bigint {
  if (typeof container === 'bigint') {
    const mask = (1n << BigInt(range.width)) - 1n;
    return (container >> BigInt(range.lo)) & mask;
  }
  // For <= 31 bits of result we can stay in number space safely with >>> .
  if (range.hi <= 30) {
    const mask = (1 << range.width) - 1;
    return (container >>> range.lo) & mask;
  }
  const big = BigInt(container >>> 0);
  const mask = (1n << BigInt(range.width)) - 1n;
  return Number((big >> BigInt(range.lo)) & mask);
}

export interface DecodedBit {
  name: string;
  range: BitRange;
  raw: number | bigint;
  display: string;
}

export function decodeBits(
  container: number | bigint,
  specs: BitSpec[],
): DecodedBit[] {
  return specs.map((s) => {
    const range = parseBitRange(s.bits);
    const raw = extractBits(container, range);
    const asBool = s.boolean ?? range.width === 1;
    let display: string;
    if (s.enum) {
      display = lookupEnum(s.enum, raw);
    } else if (asBool) {
      display = raw ? 'true' : 'false';
    } else {
      display = raw.toString();
    }
    return { name: s.name, range, raw, display };
  });
}

function lookupEnum(
  e: Record<string, string | number> | { value: number | string; name: string }[],
  raw: number | bigint,
): string {
  const key = raw.toString();
  if (Array.isArray(e)) {
    const hit = e.find((x) => String(x.value) === key);
    return hit ? `${hit.name} (${key})` : key;
  }
  // Record can be value->label or label->value; try value->label first.
  if (Object.prototype.hasOwnProperty.call(e, key)) {
    return `${e[key]} (${key})`;
  }
  const inverse = Object.entries(e).find(([, v]) => String(v) === key);
  return inverse ? `${inverse[0]} (${key})` : key;
}

/** Render "Bit 7 6 5 4 3 2 1 0 / 0 0 0 1 0 1 0 1" style visualization data. */
export function bitGrid(container: number, containerBits: number): { index: number; bit: number }[] {
  const out: { index: number; bit: number }[] = [];
  for (let i = containerBits - 1; i >= 0; i--) {
    out.push({ index: i, bit: (container >>> i) & 1 });
  }
  return out;
}
