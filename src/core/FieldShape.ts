/**
 * Shared classification of a FieldDefinition's "shape". Used by the parser, the
 * schema validator and the format editor so they all agree on what counts as a
 * nested structure vs. a bit-field vs. a primitive.
 *
 * Rules:
 *  - `fields` whose first entry has a string `bits` property  -> bit-field form
 *  - any other non-`bits` `fields` array (with or without `type: "struct"`)
 *      -> nested structure / container
 *  - otherwise -> primitive (needs a `type`)
 */

import type { BitSpec, FieldDefinition } from '../types/format';
import { getScalarType } from './DataTypes';

export function hasType(field: Pick<FieldDefinition, 'type'>): boolean {
  return typeof field.type === 'string' && field.type.trim() !== '';
}

export function isBitFieldForm(field: Pick<FieldDefinition, 'type' | 'fields'>): boolean {
  const f = field.fields;
  if (!Array.isArray(f) || f.length === 0) {
    return false;
  }
  const first = f[0] as Partial<BitSpec>;
  if (typeof first.bits !== 'string') {
    return false;
  }
  // A bit-field is always anchored on an integer/flags container type.
  return (
    field.type === 'flags' ||
    field.type === 'bitfield' ||
    (typeof field.type === 'string' && getScalarType(field.type) !== undefined)
  );
}

/** True when the field is a nested structure/container (typeless or `type: "struct"`). */
export function isContainerForm(field: Pick<FieldDefinition, 'type' | 'fields'>): boolean {
  if (!Array.isArray(field.fields)) {
    return false;
  }
  if (isBitFieldForm(field)) {
    return false;
  }
  // Empty `fields` + no usable type: still a (degenerate) container, not a primitive.
  if (field.fields.length === 0) {
    return !hasType(field) || field.type === 'struct';
  }
  const first = field.fields[0] as Partial<BitSpec> & Partial<FieldDefinition>;
  if (typeof first.bits === 'string') {
    return false;
  }
  return true;
}

/** The child fields of a container, typed as FieldDefinition[]. */
export function containerChildren(field: FieldDefinition): FieldDefinition[] {
  return Array.isArray(field.fields) ? (field.fields as FieldDefinition[]) : [];
}
