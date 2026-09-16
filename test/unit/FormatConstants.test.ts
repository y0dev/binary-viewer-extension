import * as assert from 'assert';
import { resolveConstants } from '../../src/core/FormatConstants';

describe('resolveConstants', () => {
  it('returns empty when constants is undefined', () => {
    const r = resolveConstants(undefined);
    assert.deepStrictEqual(r.values, {});
    assert.deepStrictEqual(r.errors, []);
  });

  it('resolves plain numbers', () => {
    const r = resolveConstants({ Rows: 4, Cols: 8 });
    assert.deepStrictEqual(r.values, { Rows: 4, Cols: 8 });
    assert.deepStrictEqual(r.errors, []);
  });

  it('sums two named constants with "+"', () => {
    const r = resolveConstants({ Mean: 10, Range: 5, Total: 'Mean + Range' });
    assert.strictEqual(r.values.Total, 15);
    assert.deepStrictEqual(r.errors, []);
  });

  it('sums a constant and a literal integer', () => {
    const r = resolveConstants({ Rows: 4, RowsPlusOne: 'Rows + 1' });
    assert.strictEqual(r.values.RowsPlusOne, 5);
  });

  it('resolves a chain of derived constants', () => {
    const r = resolveConstants({ A: 1, B: 'A + 1', C: 'B + 1' });
    assert.strictEqual(r.values.A, 1);
    assert.strictEqual(r.values.B, 2);
    assert.strictEqual(r.values.C, 3);
    assert.deepStrictEqual(r.errors, []);
  });

  it('reports a circular reference and leaves it unresolved', () => {
    const r = resolveConstants({ A: 'B + 1', B: 'A + 1' });
    assert.strictEqual(r.values.A, undefined);
    assert.strictEqual(r.values.B, undefined);
    assert.ok(r.errors.some((e) => e.includes('circular')));
  });

  it('reports an unknown term', () => {
    const r = resolveConstants({ Total: 'Rows + Cols' });
    assert.strictEqual(r.values.Total, undefined);
    assert.strictEqual(r.errors.length, 1);
  });

  it('reports a non-finite number', () => {
    const r = resolveConstants({ Bad: Number.POSITIVE_INFINITY });
    assert.strictEqual(r.values.Bad, undefined);
    assert.ok(r.errors.length > 0);
  });

  it('rejects a malformed sum expression', () => {
    const r = resolveConstants({ Bad: 'Rows *' });
    assert.strictEqual(r.values.Bad, undefined);
    assert.ok(r.errors.length > 0);
  });
});
