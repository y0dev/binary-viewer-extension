import * as assert from 'assert';
import { buildLayout } from '../../src/core/FormatLayout';

describe('buildLayout', () => {
  it('packs fields, expands structures and reports the total', () => {
    const l = buildLayout({
      name: 'x',
      structures: { Vec: { fields: [{ name: 'x', type: 'float32' }, { name: 'y', type: 'float32' }] } },
      fields: [
        { name: 'magic', type: 'uint32' },
        { name: 'pos', type: 'Vec' },
        { name: 'tail', type: 'uint8', offset: 20 },
      ],
    });
    const byName = Object.fromEntries(l.rows.map((r) => [r.name, r]));
    assert.strictEqual(byName.pos.offset, 4);
    assert.strictEqual(byName.pos.size, 8);
    assert.strictEqual(byName.y.offset, 8);
    assert.strictEqual(l.totalSize, 21);
  });

  it('marks cstring sizes unknown and later offsets approximate', () => {
    const l = buildLayout({
      name: 'x',
      fields: [{ name: 's', type: 'cstring' }, { name: 'n', type: 'uint8' }],
    });
    assert.strictEqual(l.rows[0].size, null);
    assert.ok(l.rows[1].approx);
    assert.ok(l.dynamic);
  });
});
