import * as assert from 'assert';
import {
  computeFieldColorRanges,
  fieldColorAt,
  FIELD_HIGHLIGHT_PALETTE,
} from '../../src/core/FieldColors';

describe('computeFieldColorRanges', () => {
  it('makes one range per top-level field, cycling the palette in definition order', () => {
    const nodes = [
      { offset: 0, size: 4, depth: 0 },
      { offset: 4, size: 2, depth: 1 }, // nested — ignored
      { offset: 6, size: 8, depth: 0 },
      { offset: 8, size: 2, depth: 2 }, // nested — ignored
      { offset: 14, size: 4, depth: 0 },
    ];
    const ranges = computeFieldColorRanges(nodes);
    assert.deepStrictEqual(
      ranges.map((r) => [r.start, r.end]),
      [
        [0, 4],
        [6, 14],
        [14, 18],
      ],
    );
    assert.deepStrictEqual(
      ranges.map((r) => r.color),
      [FIELD_HIGHLIGHT_PALETTE[0], FIELD_HIGHLIGHT_PALETTE[1], FIELD_HIGHLIGHT_PALETTE[2]],
    );
  });

  it('excludes zero-size fields', () => {
    const ranges = computeFieldColorRanges([
      { offset: 0, size: 0, depth: 0 },
      { offset: 0, size: 4, depth: 0 },
    ]);
    assert.strictEqual(ranges.length, 1);
  });

  it('cycles the palette past its length', () => {
    const n = FIELD_HIGHLIGHT_PALETTE.length + 2;
    const nodes = Array.from({ length: n }, (_, i) => ({ offset: i * 4, size: 4, depth: 0 }));
    const ranges = computeFieldColorRanges(nodes);
    assert.strictEqual(ranges[0].color, ranges[FIELD_HIGHLIGHT_PALETTE.length].color);
    assert.strictEqual(ranges[1].color, ranges[FIELD_HIGHLIGHT_PALETTE.length + 1].color);
  });

  it('sorts by offset even when fields are defined out of order', () => {
    const ranges = computeFieldColorRanges([
      { offset: 10, size: 2, depth: 0 },
      { offset: 0, size: 4, depth: 0 },
    ]);
    assert.deepStrictEqual(
      ranges.map((r) => r.start),
      [0, 10],
    );
  });
});

describe('fieldColorAt', () => {
  const ranges = computeFieldColorRanges([
    { offset: 0, size: 4, depth: 0 }, // [0,4)
    { offset: 8, size: 4, depth: 0 }, // [8,12)
  ]);

  it('finds the range covering an offset, including its start and last byte', () => {
    assert.strictEqual(fieldColorAt(ranges, 0), ranges[0].color);
    assert.strictEqual(fieldColorAt(ranges, 3), ranges[0].color);
    assert.strictEqual(fieldColorAt(ranges, 8), ranges[1].color);
    assert.strictEqual(fieldColorAt(ranges, 11), ranges[1].color);
  });

  it('returns undefined just past a range end, in a gap, and out of bounds', () => {
    assert.strictEqual(fieldColorAt(ranges, 4), undefined); // end is exclusive
    assert.strictEqual(fieldColorAt(ranges, 6), undefined); // gap between fields
    assert.strictEqual(fieldColorAt(ranges, 12), undefined); // past the last range
  });

  it('returns undefined for an empty range list', () => {
    assert.strictEqual(fieldColorAt([], 0), undefined);
  });
});
