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

describe('buildLayout struct sizes', () => {
  it('reports each reusable structure size and keeps its scratch rows out of the table', () => {
    const l = buildLayout({
      name: 'x',
      structures: { Vec: { fields: [{ name: 'x', type: 'float32' }, { name: 'y', type: 'float32' }], sizeAlign: 16 } },
      fields: [{ name: 'v', type: 'Vec' }],
    });
    assert.deepStrictEqual(l.structs, [{ name: 'Vec', size: 16, sizeAlign: 16 }]);
    assert.ok(l.rows.every((r) => r.depth === 0 || r.name !== ''));
    assert.strictEqual(l.rows.length, 3);
  });
});
