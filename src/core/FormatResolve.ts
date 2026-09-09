/**
 * Expands reusable named `structures` into inline `fields` so the rest of the
 * pipeline (parser, size computation, sections) never has to know about them.
 * Pure — no I/O.
 *
 *   { "structures": { "Rec": { "fields": [...] } },
 *     "fields": [ { "name": "records", "type": "array",
 *                   "items": { "name": "item", "type": "Rec" } } ] }
 *
 * A field whose `type` names a structure and which has no `fields` of its own
 * becomes a typeless container carrying the structure's fields.
 */

import type { FieldDefinition, FormatDefinition, StructBody } from '../types/format';
import { expandShorthandField } from './FieldSyntax';

export interface ResolveResult {
  format: FormatDefinition;
  errors: string[];
}

function looksLikeBitSpecs(fields: unknown): boolean {
  return (
    Array.isArray(fields) &&
    fields.length > 0 &&
    typeof (fields[0] as { bits?: unknown }).bits === 'string'
  );
}

export function resolveStructures(format: FormatDefinition): ResolveResult {
  const table = format.structures ?? {};
  const names = new Set(Object.keys(table));
  const errors: string[] = [];
  const MAX_DEPTH = 64;

  const resolveField = (raw: FieldDefinition, stack: string[]): FieldDefinition => {
    const f = expandShorthandField(raw); // "float32[8]" -> a real array field
    const isRef =
      typeof f.type === 'string' && names.has(f.type) && !Array.isArray(f.fields);

    if (isRef) {
      const refName = f.type as string;
      if (stack.includes(refName) || stack.length > MAX_DEPTH) {
        errors.push(
          `Recursive structure reference: ${[...stack, refName].join(' -> ')}`,
        );
        return { name: f.name, type: 'bytes', size: 0, offset: f.offset, description: `<unresolved ${refName}>` };
      }
      const body: StructBody = table[refName];
      const nextStack = [...stack, refName];
      const inlined: FieldDefinition = {
        ...f,
        type: undefined,
        fields: (body.fields ?? []).map((c) => resolveField(c, nextStack)),
      };
      if (inlined.size === undefined && body.size !== undefined) {
        inlined.size = body.size;
      }
      if (inlined.endianness === undefined && body.endianness !== undefined) {
        inlined.endianness = body.endianness;
      }
      if (inlined.description === undefined && body.description !== undefined) {
        inlined.description = body.description;
      }
      return inlined;
    }

    // Recurse into inline nested structures and array element templates.
    const out: FieldDefinition = { ...f };
    if (Array.isArray(f.fields) && !looksLikeBitSpecs(f.fields)) {
      out.fields = (f.fields as FieldDefinition[]).map((c) => resolveField(c, stack));
    }
    if (f.items) {
      out.items = resolveField(f.items, stack);
    }
    return out;
  };

  const fields = (format.fields ?? []).map((f) => resolveField(f, []));
  // Strip `structures` from the resolved copy.
  const resolved: FormatDefinition = { ...format, fields };
  delete resolved.structures;
  return { format: resolved, errors: dedupe(errors) };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}
