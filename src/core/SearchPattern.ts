/**
 * Compile a SearchQuery into a byte-level matcher. Pure. The host runs the scan
 * block-by-block over the file so the full file is never materialised.
 */

import type { SearchQuery } from '../types/messages';

export interface CompiledPattern {
  length: number;
  /** Test whether the pattern matches buf starting at pos. Caller guarantees pos+length <= buf.length. */
  test(buf: Uint8Array, pos: number): boolean;
  /** First byte value(s) that can start a match, for a quick skip. undefined = any. */
  firstByte?: number;
}

function foldAscii(b: number): number {
  // Uppercase A-Z -> lowercase
  return b >= 0x41 && b <= 0x5a ? b + 0x20 : b;
}

function compileBytes(bytes: number[], mask: number[], caseInsensitive: boolean): CompiledPattern {
  const b = Uint8Array.from(bytes);
  const m = Uint8Array.from(mask);
  const ci = caseInsensitive;
  const anyFirst = m[0] !== 0xff;
  return {
    length: b.length,
    firstByte: anyFirst || ci ? undefined : b[0],
    test(buf, pos) {
      for (let i = 0; i < b.length; i++) {
        const mm = m[i];
        if (mm === 0) {
          continue;
        }
        let actual = buf[pos + i];
        let expected = b[i];
        if (ci) {
          actual = foldAscii(actual);
          expected = foldAscii(expected);
        }
        if ((actual & mm) !== (expected & mm)) {
          return false;
        }
      }
      return true;
    },
  };
}

export function parseHexPattern(text: string): { bytes: number[]; mask: number[] } {
  const cleaned = text.trim().replace(/0x/gi, '').replace(/[\s,_-]+/g, ' ').trim();
  const bytes: number[] = [];
  const mask: number[] = [];
  if (cleaned.includes(' ')) {
    for (const tok of cleaned.split(' ')) {
      if (tok === '') {
        continue;
      }
      if (tok === '??' || tok === '**') {
        bytes.push(0);
        mask.push(0x00);
        continue;
      }
      if (tok.length !== 2 || !/^[0-9a-f?]{2}$/i.test(tok)) {
        throw new Error(`Invalid hex byte "${tok}"`);
      }
      let bMask = 0xff;
      let value = 0;
      for (let n = 0; n < 2; n++) {
        const c = tok[n];
        value <<= 4;
        if (c === '?') {
          bMask &= n === 0 ? 0x0f : 0xf0;
        } else {
          value |= parseInt(c, 16);
        }
      }
      bytes.push(value);
      mask.push(bMask);
    }
  } else {
    const nibs = cleaned.replace(/\s/g, '');
    if (nibs.length % 2 !== 0) {
      throw new Error('Hex pattern must have an even number of digits');
    }
    if (!/^[0-9a-f?]*$/i.test(nibs)) {
      throw new Error('Hex pattern contains non-hex characters');
    }
    for (let i = 0; i < nibs.length; i += 2) {
      const hi = nibs[i];
      const lo = nibs[i + 1];
      let bMask = 0xff;
      let value = 0;
      if (hi === '?') {
        bMask &= 0x0f;
      } else {
        value |= parseInt(hi, 16) << 4;
      }
      if (lo === '?') {
        bMask &= 0xf0;
      } else {
        value |= parseInt(lo, 16);
      }
      bytes.push(value);
      mask.push(bMask);
    }
  }
  if (bytes.length === 0) {
    throw new Error('Empty hex pattern');
  }
  return { bytes, mask };
}

export function parseBitPattern(text: string): { bytes: number[]; mask: number[] } {
  const cleaned = text.trim().replace(/0b/gi, '').replace(/[\s_]+/g, '');
  if (!/^[01?]+$/.test(cleaned)) {
    throw new Error('Bit pattern may only contain 0, 1 and ?');
  }
  if (cleaned.length % 8 !== 0) {
    throw new Error('Bit pattern length must be a multiple of 8');
  }
  const bytes: number[] = [];
  const mask: number[] = [];
  for (let i = 0; i < cleaned.length; i += 8) {
    let value = 0;
    let bMask = 0;
    for (let n = 0; n < 8; n++) {
      value <<= 1;
      bMask <<= 1;
      const c = cleaned[i + n];
      if (c === '1') {
        value |= 1;
        bMask |= 1;
      } else if (c === '0') {
        bMask |= 1;
      }
    }
    bytes.push(value);
    mask.push(bMask);
  }
  return { bytes, mask };
}

export function compileSearch(query: SearchQuery): CompiledPattern {
  const { kind, text } = query;
  if (text === '') {
    throw new Error('Empty search');
  }
  switch (kind) {
    case 'hex': {
      const { bytes, mask } = parseHexPattern(text);
      return compileBytes(bytes, mask, false);
    }
    case 'bits': {
      const { bytes, mask } = parseBitPattern(text);
      return compileBytes(bytes, mask, false);
    }
    case 'ascii': {
      const bytes = Array.from(text, (c) => c.charCodeAt(0) & 0xff);
      return compileBytes(bytes, bytes.map(() => 0xff), !!query.caseInsensitive);
    }
    case 'utf8': {
      const bytes = Array.from(new TextEncoder().encode(text));
      return compileBytes(bytes, bytes.map(() => 0xff), false);
    }
    case 'utf16': {
      const bytes: number[] = [];
      for (let i = 0; i < text.length; i++) {
        const cc = text.charCodeAt(i);
        bytes.push(cc & 0xff, (cc >> 8) & 0xff); // little-endian
      }
      return compileBytes(bytes, bytes.map(() => 0xff), false);
    }
    default:
      throw new Error(`Unknown search kind: ${kind}`);
  }
}

/**
 * Scan a contiguous buffer for all matches. `bufBaseOffset` is the file offset
 * of buf[0]. Matches are reported as absolute file offsets. To find matches that
 * straddle block boundaries the caller should overlap consecutive buffers by
 * (pattern.length - 1) bytes and de-duplicate.
 */
export function scanBuffer(
  pattern: CompiledPattern,
  buf: Uint8Array,
  bufBaseOffset: number,
  opts: { limit?: number; startInBuf?: number; endInBuf?: number } = {},
): number[] {
  const out: number[] = [];
  const limit = opts.limit ?? Infinity;
  const last = Math.min(opts.endInBuf ?? buf.length, buf.length) - pattern.length;
  let i = Math.max(0, opts.startInBuf ?? 0);
  const fb = pattern.firstByte;
  for (; i <= last; i++) {
    if (fb !== undefined && buf[i] !== fb) {
      continue;
    }
    if (pattern.test(buf, i)) {
      out.push(bufBaseOffset + i);
      if (out.length >= limit) {
        break;
      }
    }
  }
  return out;
}
