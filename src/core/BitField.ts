/**
 * Bit-field extraction. LSB is bit 0. A spec is a single bit ("4"), an
 * inclusive range ("1-3" / "3-1", order-insensitive), or a comma-separated
 * list of either ("0-5,12-13,16-31") for a field split across non-contiguous
 * bit positions — common when the "leftover" bits around several named
 * fields are grouped into one "Reserved" spec. The parts combine into one
 * value, the first-listed part becoming the value's low-order bits.
 */

import type { BitSpec } from '../types/format';

export interface BitRangePart {
  /** Low bit index, inclusive. */
  lo: number;
  /** High bit index, inclusive. */
  hi: number;
}

export interface BitRange {
  /** Each contiguous piece, in spec order (first = low bits of the combined value). */
  parts: BitRangePart[];
  /** Lowest bit index across every part, inclusive. */
  lo: number;
  /** Highest bit index across every part, inclusive. */
  hi: number;
  /** Total combined width — the sum of each part's width. */
  width: number;
}

const PART_RE = /^(\d+)\s*(?:[-:]\s*(\d+))?$/;

export function parseBitRange(spec: string): BitRange {
  const pieces = spec.split(',').map((p) => p.trim());
  if (pieces.length === 0 || pieces.some((p) => p === '')) {
    throw new Error(`Invalid bit spec: "${spec}" (expected "N", "N-M", or a comma-separated list of those)`);
  }
  const parts: BitRangePart[] = pieces.map((piece) => {
    const m = PART_RE.exec(piece);
    if (!m) {
      throw new Error(`Invalid bit spec: "${spec}" (expected "N", "N-M", or a comma-separated list of those)`);
    }
    const a = parseInt(m[1], 10);
    const b = m[2] !== undefined ? parseInt(m[2], 10) : a;
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  });
  const lo = Math.min(...parts.map((p) => p.lo));
  const hi = Math.max(...parts.map((p) => p.hi));
  const width = parts.reduce((sum, p) => sum + (p.hi - p.lo + 1), 0);
  return { parts, lo, hi, width };
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
    for (const part of range.parts) {
      for (let i = part.lo; i <= part.hi; i++) {
        if (used[i]) {
          errors.push(`Field "${s.name}" overlaps "${used[i]}" at bit ${i}`);
        } else {
          used[i] = s.name;
        }
      }
    }
  }
  return errors;
}

function extractSinglePart(container: number | bigint, part: BitRangePart): number | bigint {
  const width = part.hi - part.lo + 1;
  if (typeof container === 'bigint') {
    const mask = (1n << BigInt(width)) - 1n;
    return (container >> BigInt(part.lo)) & mask;
  }
  // For <= 31 bits of result we can stay in number space safely with >>> .
  if (part.hi <= 30) {
    const mask = (1 << width) - 1;
    return (container >>> part.lo) & mask;
  }
  const big = BigInt(container >>> 0);
  const mask = (1n << BigInt(width)) - 1n;
  return Number((big >> BigInt(part.lo)) & mask);
}

/** Extract the unsigned integer value of a (possibly multi-part) bit range from a container value. */
export function extractBits(container: number | bigint, range: BitRange): number | bigint {
  if (range.parts.length === 1) {
    return extractSinglePart(container, range.parts[0]);
  }
  let result = 0n;
  let shift = 0;
  for (const part of range.parts) {
    const bits = extractSinglePart(container, part);
    result |= (typeof bits === 'bigint' ? bits : BigInt(bits)) << BigInt(shift);
    shift += part.hi - part.lo + 1;
  }
  return typeof container === 'bigint' ? result : Number(result);
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
