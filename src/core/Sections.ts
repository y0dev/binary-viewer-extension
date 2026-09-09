/**
 * Builds the rows for the Sections / memory-map view. Pure — no I/O.
 *
 * A section list comes from one of two places:
 *   1. an explicit `sections` array in the format definition, or
 *   2. (fallback) the top-level fields of the parsed structure.
 */

import type { FormatDefinition, SectionDefinition } from '../types/format';
import type { ParsedSection } from '../types/messages';
import { parseNumericInput } from './humanize';

export function normalizeAddress(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
  }
  if (typeof value === 'string') {
    return parseNumericInput(value);
  }
  return undefined;
}

interface TopNode {
  name: string;
  offset: number;
  size: number;
  depth: number;
}

function fromDefinition(defs: SectionDefinition[], fileSize: number): ParsedSection[] {
  const out: ParsedSection[] = [];
  defs.forEach((s, i) => {
    const start = normalizeAddress(s.start);
    let length = normalizeAddress(s.length);
    const end = normalizeAddress(s.end);
    if (start === undefined) {
      out.push({
        name: s.name || `section[${i}]`,
        start: 0,
        length: 0,
        end: 0,
        flags: s.flags,
        display: s.display,
        inFile: false,
        source: 'defined',
        error: 'invalid start address',
      });
      return;
    }
    if (length === undefined && end !== undefined) {
      length = Math.max(0, end - start);
    }
    if (length === undefined) {
      length = 0;
    }
    out.push({
      name: s.name || `section[${i}]`,
      start,
      length,
      end: start + length,
      flags: typeof s.flags === 'string' ? s.flags : undefined,
      display: typeof s.display === 'boolean' ? s.display : undefined,
      inFile: start < fileSize,
      source: 'defined',
      description: s.description,
    });
  });
  return out;
}

function fromStructure(nodes: TopNode[], fileSize: number): ParsedSection[] {
  return nodes
    .filter((n) => n.depth === 0 && n.size > 0)
    .map((n) => ({
      name: n.name,
      start: n.offset,
      length: n.size,
      end: n.offset + n.size,
      inFile: n.offset < fileSize,
      display: undefined,
      flags: undefined,
      source: 'derived' as const,
    }));
}

export function buildSections(
  format: FormatDefinition | undefined,
  topNodes: TopNode[],
  fileSize: number,
): ParsedSection[] {
  if (format?.sections && format.sections.length > 0) {
    return fromDefinition(format.sections, fileSize);
  }
  return fromStructure(topNodes, fileSize);
}

/** True when at least one row carries a `flags` value. */
export function hasFlagsColumn(rows: ParsedSection[]): boolean {
  return rows.some((r) => typeof r.flags === 'string' && r.flags !== '');
}

/** True when at least one row explicitly set `display`. */
export function hasDisplayColumn(rows: ParsedSection[]): boolean {
  return rows.some((r) => typeof r.display === 'boolean');
}
