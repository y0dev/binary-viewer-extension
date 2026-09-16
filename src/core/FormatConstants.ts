/**
 * Resolver for a format's top-level `constants` map — named numeric values a
 * field can reference by name (e.g. for an array's `count`, via `countField`),
 * instead of only an earlier decoded field's value.
 *
 * A constant is either a plain number, or a string that sums named constants
 * and/or literal integers with `+` (e.g. `"Mean + Range"`, `"Number of Dogs +
 * Number of Cats"`, `"Rows + 1"`). A name can contain spaces — a term is
 * matched against the other defined constant names, not an identifier
 * pattern — so it just can't contain a literal `+`. That's the only
 * operation supported — this stays declarative data, never code to execute.
 */

export type ConstantsMap = Record<string, number | string>;

export interface ResolveConstantsResult {
  /** name -> resolved numeric value, for every constant that resolved cleanly. */
  values: Record<string, number>;
  /** One message per constant that couldn't be resolved (bad syntax, unknown term, cycle). */
  errors: string[];
}

const INT_RE = /^-?\d+$/;

/** Resolve every entry in `constants`, following `"A + B + 1"`-style sums, with cycle detection. */
export function resolveConstants(constants: ConstantsMap | undefined): ResolveConstantsResult {
  const values: Record<string, number> = {};
  const errors: string[] = [];
  if (!constants) {
    return { values, errors };
  }
  const resolving = new Set<string>();

  function resolveOne(name: string): number | undefined {
    if (name in values) {
      return values[name];
    }
    if (!Object.prototype.hasOwnProperty.call(constants!, name)) {
      return undefined;
    }
    if (resolving.has(name)) {
      errors.push(`constants.${name}: circular reference`);
      return undefined;
    }
    resolving.add(name);
    const raw = constants![name];
    let result: number | undefined;
    if (typeof raw === 'number') {
      result = Number.isFinite(raw) ? raw : undefined;
      if (result === undefined) {
        errors.push(`constants.${name}: must be a finite number`);
      }
    } else if (typeof raw === 'string') {
      const terms = raw.split('+').map((t) => t.trim());
      let sum = 0;
      let ok = terms.length > 0 && terms.every((t) => t !== '');
      for (const term of terms) {
        if (!ok) {
          break;
        }
        if (INT_RE.test(term)) {
          sum += Number(term);
        } else if (Object.prototype.hasOwnProperty.call(constants!, term)) {
          const v = resolveOne(term);
          if (v === undefined) {
            ok = false;
          } else {
            sum += v;
          }
        } else {
          ok = false;
        }
      }
      if (ok) {
        result = sum;
      } else {
        errors.push(
          `constants.${name}: expected a number, or a "+"-separated sum of numbers/constant names, got "${raw}"`,
        );
      }
    } else {
      errors.push(`constants.${name}: must be a number or a string`);
    }
    resolving.delete(name);
    if (result !== undefined) {
      values[name] = result;
    }
    return result;
  }

  for (const name of Object.keys(constants)) {
    resolveOne(name);
  }
  return { values, errors };
}
