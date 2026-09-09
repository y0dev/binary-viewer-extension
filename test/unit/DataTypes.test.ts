import * as assert from 'assert';
import { getScalarType, formatScalar } from '../../src/core/DataTypes';

function dv(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

describe('DataTypes scalar registry', () => {
  it('reads every integer width, little and big endian', () => {
    const bytes = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
    const v = dv(bytes);

    assert.strictEqual(getScalarType('uint8')!.read(v, 0, true), 1);
    assert.strictEqual(getScalarType('int8')!.read(v, 0, true), 1);

    assert.strictEqual(getScalarType('uint16')!.read(v, 0, true), 0x0201);
    assert.strictEqual(getScalarType('uint16')!.read(v, 0, false), 0x0102);
    assert.strictEqual(getScalarType('int16')!.read(v, 0, true), 0x0201);

    assert.strictEqual(getScalarType('uint32')!.read(v, 0, true), 0x04030201);
    assert.strictEqual(getScalarType('uint32')!.read(v, 0, false), 0x01020304);
    assert.strictEqual(getScalarType('int32')!.read(v, 0, false), 0x01020304);

    assert.strictEqual(getScalarType('uint64')!.read(v, 0, true), 0x0807060504030201n);
    assert.strictEqual(getScalarType('uint64')!.read(v, 0, false), 0x0102030405060708n);
    assert.strictEqual(getScalarType('int64')!.read(v, 0, true), 0x0807060504030201n);
  });

  it('reads signed negatives correctly', () => {
    const v = dv([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    assert.strictEqual(getScalarType('int8')!.read(v, 0, true), -1);
    assert.strictEqual(getScalarType('int16')!.read(v, 0, true), -1);
    assert.strictEqual(getScalarType('int32')!.read(v, 0, true), -1);
    assert.strictEqual(getScalarType('int64')!.read(v, 0, true), -1n);
    assert.strictEqual(getScalarType('uint8')!.read(v, 0, true), 255);
  });

  it('reads float32 and float64 with both endiannesses', () => {
    const le = new DataView(new ArrayBuffer(8));
    le.setFloat32(0, 12.5, true);
    assert.strictEqual(getScalarType('float32')!.read(le, 0, true), 12.5);

    const be = new DataView(new ArrayBuffer(8));
    be.setFloat64(0, -3.5, false);
    assert.strictEqual(getScalarType('float64')!.read(be, 0, false), -3.5);
    assert.strictEqual(getScalarType('double')!.read(be, 0, false), -3.5);
  });

  it('resolves aliases', () => {
    assert.strictEqual(getScalarType('byte')!.size, 1);
    assert.strictEqual(getScalarType('float')!.name, 'float32');
    assert.strictEqual(getScalarType('bool')!.read(dv([0x00]), 0, true), false);
    assert.strictEqual(getScalarType('boolean')!.read(dv([0x07]), 0, true), true);
  });

  it('formats values with display hints', () => {
    const u32 = getScalarType('uint32')!;
    assert.strictEqual(formatScalar(255, u32, 'hex'), '0x000000FF');
    assert.strictEqual(formatScalar(255, u32, 'dec'), '255');
    assert.strictEqual(formatScalar(5, u32, 'bin'), '0b00000000000000000000000000000101');
    assert.strictEqual(formatScalar(0x1122334455667788n, getScalarType('uint64')!, 'hex'), '0x1122334455667788');
  });
});
