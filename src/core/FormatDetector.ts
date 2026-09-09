/**
 * Pure format-detection scoring. Given a filename, a header byte window and a
 * set of candidate formats, rank the ones that match. No I/O.
 */

import type { FormatDefinition, MagicSpec } from '../types/format';
import { parseMagicBytes } from './FormatSchema';

export interface DetectionCandidate {
  format: FormatDefinition;
  /** Higher is better. */
  score: number;
  reasons: string[];
}

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i).toLowerCase() : '';
}

function normExt(e: string): string {
  const t = e.trim().toLowerCase();
  return t.startsWith('.') ? t : '.' + t;
}

export function magicMatches(magic: MagicSpec, header: Uint8Array): boolean {
  let bytes: number[];
  let mask: number[] | undefined;
  try {
    bytes = parseMagicBytes(magic.bytes);
    mask = magic.mask ? parseMagicBytes(magic.mask) : undefined;
  } catch {
    return false;
  }
  const start = magic.offset;
  if (start + bytes.length > header.length) {
    return false;
  }
  for (let i = 0; i < bytes.length; i++) {
    const actual = header[start + i];
    const expected = bytes[i];
    if (mask) {
      if ((actual & mask[i]) !== (expected & mask[i])) {
        return false;
      }
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

export function scoreFormat(
  format: FormatDefinition,
  fileName: string,
  header: Uint8Array,
): DetectionCandidate | null {
  const reasons: string[] = [];
  let score = 0;

  const ext = extOf(fileName);
  const exts = (format.fileExtensions ?? []).map(normExt);
  const extMatch = ext !== '' && exts.includes(ext);
  if (extMatch) {
    score += 10;
    reasons.push(`extension ${ext}`);
  }

  const magics = format.magic ? (Array.isArray(format.magic) ? format.magic : [format.magic]) : [];
  let magicMatch = false;
  for (const m of magics) {
    if (magicMatches(m, header)) {
      magicMatch = true;
      score += 100;
      reasons.push(`magic @${m.offset}`);
      break;
    }
  }

  // A format that declares magic but does not match is disqualified.
  if (magics.length > 0 && !magicMatch) {
    return null;
  }
  if (!extMatch && !magicMatch) {
    return null;
  }
  return { format, score, reasons };
}

export function detectFormats(
  formats: FormatDefinition[],
  fileName: string,
  header: Uint8Array,
): DetectionCandidate[] {
  const out: DetectionCandidate[] = [];
  for (const f of formats) {
    const c = scoreFormat(f, fileName, header);
    if (c) {
      out.push(c);
    }
  }
  out.sort((a, b) => b.score - a.score || a.format.name.localeCompare(b.format.name));
  return out;
}
