import * as assert from 'assert';
import {
  computeFieldColorRanges,
  fieldColorAt,
  fieldColorBackground,
  fieldColorForeground,
  normalizeFieldColorBrightness,
  resolveFieldHighlight,
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

describe('Field Colors settings', () => {
  it('uses the existing 20% tint and clamps background intensity to visible limits', () => {
    assert.strictEqual(fieldColorBackground('#e69f00', 20), '#e69f0033');
    assert.strictEqual(fieldColorBackground('#e69f00', 0), '#e69f001a');
    assert.strictEqual(fieldColorBackground('#e69f00', 100), '#e69f0099');
    assert.strictEqual(fieldColorBackground('#e69f00', 50), '#e69f0080');
  });

  it('clamps invalid brightness values and falls back to a readable default', () => {
    assert.strictEqual(normalizeFieldColorBrightness(-10), 10);
    assert.strictEqual(normalizeFieldColorBrightness(120), 60);
    assert.strictEqual(normalizeFieldColorBrightness(20.6), 21);
    assert.strictEqual(normalizeFieldColorBrightness(NaN), 20);
    assert.strictEqual(normalizeFieldColorBrightness(Infinity), 20);
  });

  it('defaults off and allows the configured default to turn colors on', () => {
    assert.strictEqual(resolveFieldHighlight(undefined, false, 'Firmware'), false);
    assert.strictEqual(resolveFieldHighlight(undefined, true, 'Firmware'), true);
  });

  it('preserves remembered per-file choices ahead of the default', () => {
    assert.strictEqual(resolveFieldHighlight(false, true, 'Firmware'), false);
    assert.strictEqual(resolveFieldHighlight(true, false, 'Firmware'), true);
  });

  it('keeps colors disabled without a format regardless of defaults or remembered state', () => {
    assert.strictEqual(resolveFieldHighlight(undefined, true, null), false);
    assert.strictEqual(resolveFieldHighlight(true, true, null), false);
  });
});

describe('Field color text contrast', () => {
  it('maintains at least 4.5:1 contrast across the supported intensity range in either theme', () => {
    for (const background of [[30, 30, 30], [255, 255, 255]]) {
      for (const color of FIELD_HIGHLIGHT_PALETTE) {
        for (const brightness of [10, 20, 40, 60, 100]) {
        const fg = fieldColorForeground(color, brightness, background);
        const alpha = normalizeFieldColorBrightness(brightness) / 100;
        const linear = [1, 3, 5].map((at, i) => {
          const c = (parseInt(color.slice(at, at + 2), 16) * alpha + background[i] * (1 - alpha)) / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        const contrast = fg === '#000000' ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
        assert.ok(contrast >= 4.5, `${color} at ${brightness}% with ${fg}: ${contrast}`);
        }
      }
    }
  });

  it('adapts text to the theme underneath the minimum visible tint', () => {
    assert.strictEqual(fieldColorForeground('#e69f00', 0, [30, 30, 30]), '#ffffff');
    assert.strictEqual(fieldColorForeground('#e69f00', 0, [255, 255, 255]), '#000000');
  });
});
