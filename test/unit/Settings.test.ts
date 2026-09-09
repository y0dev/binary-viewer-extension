import * as assert from 'assert';
import { parseFormat, ByteWindow, epochOffsetMs } from '../../src/core/BinaryParser';
import { resolveBaseAddress } from '../../src/core/humanize';
import { validateFormat } from '../../src/core/FormatSchema';
import type { FormatDefinition } from '../../src/types/format';

function win(bytes: number[], fileSize = bytes.length): ByteWindow {
  return { baseOffset: 0, bytes: Uint8Array.from(bytes), fileSize };
}

function le32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

describe('resolveBaseAddress', () => {
  it('accepts numbers, hex / decimal / "…h" strings', () => {
    assert.strictEqual(resolveBaseAddress(0x08000000), 0x08000000);
    assert.strictEqual(resolveBaseAddress('0x08000000'), 0x08000000);
    assert.strictEqual(resolveBaseAddress('134217728'), 0x08000000);
    assert.strictEqual(resolveBaseAddress('8000000h'), 0x08000000);
  });
  it('treats empty / invalid / negative input as 0', () => {
    assert.strictEqual(resolveBaseAddress(''), 0);
    assert.strictEqual(resolveBaseAddress('nope'), 0);
    assert.strictEqual(resolveBaseAddress(-5), 0);
    assert.strictEqual(resolveBaseAddress(undefined), 0);
  });
});

describe('validateFormat — baseAddress', () => {
  const base = (v: unknown): FormatDefinition =>
    ({ name: 'f', baseAddress: v as never, fields: [{ name: 'x', type: 'uint8', offset: 0 }] });
  it('accepts a number or an address string', () => {
    assert.ok(validateFormat(base(0x8000000)).valid);
    assert.ok(validateFormat(base('0x8000000')).valid);
  });
  it('rejects garbage', () => {
    assert.ok(!validateFormat(base('banana')).valid);
    assert.ok(!validateFormat(base(-1)).valid);
  });
});

describe('validateFormat — array countField', () => {
  const arr = (extra: Record<string, unknown>): FormatDefinition =>
    ({
      name: 'f',
      fields: [{ name: 'xs', type: 'array', offset: 0, items: { name: 'v', type: 'uint8' }, ...extra }],
    }) as FormatDefinition;

  it('accepts an array sized by countField instead of count', () => {
    assert.ok(validateFormat(arr({ countField: 'n' })).valid);
  });
  it('rejects an array with neither count nor countField', () => {
    assert.ok(!validateFormat(arr({})).valid);
  });
  it('rejects an empty countField', () => {
    assert.ok(!validateFormat(arr({ countField: '  ' })).valid);
  });
  it('warns (does not fail) when both count and countField are set', () => {
    const r = validateFormat(arr({ count: 2, countField: 'n' }));
    assert.ok(r.valid);
    assert.ok(r.warnings.some((w) => /both set/.test(w)));
  });
});

describe('epochOffsetMs', () => {
  it('maps the named epochs', () => {
    assert.strictEqual(epochOffsetMs('unix'), 0);
    assert.strictEqual(epochOffsetMs(undefined), 0);
    assert.strictEqual(epochOffsetMs('y2k'), Date.UTC(2000, 0, 1));
    assert.strictEqual(epochOffsetMs('gps'), Date.UTC(1980, 0, 6));
    assert.strictEqual(epochOffsetMs('mac'), Date.UTC(1904, 0, 1));
    assert.strictEqual(epochOffsetMs('filetime'), Date.UTC(1601, 0, 1));
  });
  it('passes a numeric epoch straight through', () => {
    assert.strictEqual(epochOffsetMs(1234), 1234);
  });
});

describe('BinaryParser — timestamp defaults', () => {
  const tsFormat = (ts: Record<string, unknown> = {}): FormatDefinition => ({
    name: 'ts',
    fields: [{ name: 't', type: 'timestamp', offset: 0, timestamp: ts as never }],
  });

  it('applies the configured default epoch when the field sets none', () => {
    // 2 seconds after the GPS epoch.
    const { nodes } = parseFormat(tsFormat({ size: 4, unit: 's' }), win(le32(2)), {
      defaultEndianness: 'little',
      timestamp: { epoch: 'gps' },
    });
    assert.strictEqual(nodes[0].value, new Date(Date.UTC(1980, 0, 6) + 2000).toISOString());
  });

  it("a field's own epoch overrides the default", () => {
    const { nodes } = parseFormat(tsFormat({ size: 4, unit: 's', epoch: 'unix' }), win(le32(0)), {
      defaultEndianness: 'little',
      timestamp: { epoch: 'gps' },
    });
    assert.strictEqual(nodes[0].value, '1970-01-01T00:00:00.000Z');
  });

  it('decodes a Windows FILETIME (100-ns ticks since 1601)', () => {
    // 2021-01-01T00:00:00Z in FILETIME ticks.
    const ticks = BigInt(Date.UTC(2021, 0, 1) - Date.UTC(1601, 0, 1)) * 10000n;
    const bytes: number[] = [];
    let v = ticks;
    for (let i = 0; i < 8; i++) {
      bytes.push(Number(v & 0xffn));
      v >>= 8n;
    }
    const { nodes } = parseFormat(tsFormat({ size: 8, epoch: 'filetime' }), win(bytes), {
      defaultEndianness: 'little',
    });
    assert.strictEqual(nodes[0].value, '2021-01-01T00:00:00.000Z');
  });

  it('renders local time when utc is false', () => {
    const { nodes } = parseFormat(tsFormat({ size: 4, unit: 's', epoch: 'unix' }), win(le32(0)), {
      defaultEndianness: 'little',
      timestamp: { utc: false },
    });
    assert.strictEqual(nodes[0].value, new Date(0).toLocaleString());
  });
});

describe('BinaryParser — maxArrayElements', () => {
  const arrFmt: FormatDefinition = {
    name: 'a',
    fields: [{ name: 'xs', type: 'float32[10]', offset: 0 }],
  };
  const bytes = new Array(40).fill(0);

  it('caps rendered elements and adds a summary row', () => {
    const { nodes } = parseFormat(arrFmt, win(bytes), {
      defaultEndianness: 'little',
      maxArrayElements: 3,
    });
    const elems = nodes.filter((n) => /^xs\[\d+\]$/.test(n.name));
    assert.strictEqual(elems.length, 3);
    const summary = nodes.find((n) => n.name === 'xs[…]');
    assert.ok(summary && /7 more elements/.test(summary.value));
  });

  it('0 means no cap', () => {
    const { nodes } = parseFormat(arrFmt, win(bytes), {
      defaultEndianness: 'little',
      maxArrayElements: 0,
    });
    assert.strictEqual(nodes.filter((n) => /^xs\[\d+\]$/.test(n.name)).length, 10);
    assert.ok(!nodes.find((n) => n.name === 'xs[…]'));
  });
});
