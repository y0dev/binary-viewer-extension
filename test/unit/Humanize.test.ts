import * as assert from 'assert';
import { groupHexDisplay } from '../../src/core/humanize';

describe('groupHexDisplay', () => {
  it('reverses byte order for a little-endian word', () => {
    assert.strictEqual(groupHexDisplay([0x01, 0x00, 0x00, 0x00], true), '00000001');
    assert.strictEqual(groupHexDisplay([0x78, 0x56, 0x34, 0x12], true), '12345678');
    assert.strictEqual(groupHexDisplay([0x34, 0x12], true), '1234');
  });
  it('keeps file order for a big-endian word', () => {
    assert.strictEqual(groupHexDisplay([0x01, 0x00, 0x00, 0x00], false), '01000000');
    assert.strictEqual(groupHexDisplay([0x12, 0x34, 0x56, 0x78], false), '12345678');
  });
  it('is a no-op for a single byte', () => {
    assert.strictEqual(groupHexDisplay([0xab], true), 'AB');
    assert.strictEqual(groupHexDisplay([0xab], false), 'AB');
  });
  it('renders missing (past-EOF) bytes as --', () => {
    assert.strictEqual(groupHexDisplay([0x7f, 0x3c, null, null], true), '----3C7F');
    assert.strictEqual(groupHexDisplay([0x7f, 0x3c, null, null], false), '7F3C----');
  });
  it('handles an 8-byte word without precision loss', () => {
    assert.strictEqual(
      groupHexDisplay([0x01, 0, 0, 0, 0, 0, 0, 0x80], true),
      '8000000000000001',
    );
  });
});
