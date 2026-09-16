import * as assert from 'assert';
import { resolveArrayView } from '../../src/core/ArrayView';

describe('resolveArrayView', () => {
  it('parses the "start...end" shorthand, both ends inclusive', () => {
    assert.deepStrictEqual(resolveArrayView('20...35', 1000), { start: 20, end: 35 });
    assert.deepStrictEqual(resolveArrayView('0...5', 1000), { start: 0, end: 5 });
  });

  it('also accepts a two-dot separator and surrounding whitespace', () => {
    assert.deepStrictEqual(resolveArrayView('20..35', 1000), { start: 20, end: 35 });
    assert.deepStrictEqual(resolveArrayView(' 20 ... 35 ', 1000), { start: 20, end: 35 });
  });

  it('accepts the { start, end } object form', () => {
    assert.deepStrictEqual(resolveArrayView({ start: 20, end: 35 }, 1000), { start: 20, end: 35 });
  });

  it('normalises a reversed range', () => {
    assert.deepStrictEqual(resolveArrayView('35...20', 1000), { start: 20, end: 35 });
    assert.deepStrictEqual(resolveArrayView({ start: 35, end: 20 }, 1000), { start: 20, end: 35 });
  });

  it('defaults a missing endpoint to the array bounds', () => {
    assert.deepStrictEqual(resolveArrayView({ start: 20 }, 1000), { start: 20, end: 999 });
    assert.deepStrictEqual(resolveArrayView({ end: 35 }, 1000), { start: 0, end: 35 });
  });

  it('clamps to the array bounds', () => {
    assert.deepStrictEqual(resolveArrayView('900...5000', 1000), { start: 900, end: 999 });
    assert.deepStrictEqual(resolveArrayView({ start: -5, end: 5 }, 1000), { start: 0, end: 5 });
  });

  it('returns null for no view, an empty object, unparseable text, or a zero-length array', () => {
    assert.strictEqual(resolveArrayView(undefined, 1000), null);
    assert.strictEqual(resolveArrayView({}, 1000), null);
    assert.strictEqual(resolveArrayView('not a range', 1000), null);
    assert.strictEqual(resolveArrayView('20...35', 0), null);
  });
});
