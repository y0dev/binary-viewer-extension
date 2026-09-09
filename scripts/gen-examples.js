/* eslint-disable */
'use strict';

// Produces the small, committed example binaries in examples/binaries/.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'examples', 'binaries');
fs.mkdirSync(OUT, { recursive: true });

// --- firmware.bin : matches "ACME Firmware Header" / builtin firmware format ---
{
  const buf = Buffer.alloc(512);
  buf.write('FW', 0, 'ascii');
  buf[2] = 0x01;
  buf[3] = 0x00;
  buf.writeUInt16LE(1, 2 + 0); // container version (overlaps intentionally? no) -> offset 2 already used
  // NOTE: offset 2..3 are magic bytes 3/4; container version lives at 2 in the
  // format but the example keeps 01 00 which reads as version 1. Fine for a demo.
  buf.writeUInt16LE(0x0207, 4); // firmware version 2.7 -> 0x0207
  buf.writeUInt16LE(0b0000_0000_0001_0101, 6); // Flags: Compressed|Encrypted|Stage=app(1)
  buf.writeUInt32LE(8192, 8); // Image Size
  buf.writeUInt32LE(0x00200000, 12); // Load Address
  buf.writeUInt32LE(Math.floor(Date.UTC(2025, 5, 1, 12, 0, 0) / 1000), 16); // Build Timestamp
  buf.writeUInt32LE(0x78563412, 20); // CRC32
  buf.write('ACME-ROUTER-9000', 24, 'ascii');
  for (let i = 64; i < buf.length; i++) buf[i] = (i * 37) & 0xff; // filler "payload"
  fs.writeFileSync(path.join(OUT, 'firmware.bin'), buf);
}

// --- config.eeprom : matches "Device EEPROM Config" (big-endian) ---
{
  const buf = Buffer.alloc(128);
  buf.writeUInt16BE(0xcafe, 0);
  buf.writeUInt8(2, 2);
  buf.writeUInt32BE(0x00012345, 4);
  Buffer.from([0x02, 0x00, 0x5e, 0x11, 0x22, 0x33]).copy(buf, 8); // MAC
  buf.writeUInt8(1, 14); // Region = ETSI
  buf.writeInt16BE(-125, 16); // Calibration Offset -1.25 dBm
  buf.writeUInt16BE(3300, 18); // VREF 3.300 V
  buf.writeUInt32BE(0x0000_030b, 20); // Feature Bits: BLE|WiFi|LoRa + HW rev 3
  buf.write('SENSOR-NODE-EU-REV3', 24, 'ascii');
  buf.writeUInt16BE(0x1234, 126);
  fs.writeFileSync(path.join(OUT, 'config.eeprom'), buf);
}

// --- telemetry.pkt : matches "Telemetry Packet v2" (big-endian) ---
{
  const buf = Buffer.alloc(48);
  buf.writeUInt16BE(0xa55a, 0);
  buf.writeUInt8(2, 2);
  buf.writeUInt8(2, 3); // GPS_FIX
  buf.writeUInt16BE(1024, 4);
  buf.writeUInt16BE(20, 6);
  buf.writeBigUInt64BE(BigInt(Date.UTC(2025, 0, 15, 8, 30, 0)), 8);
  buf.writeInt32BE(Math.round(37.7749 * 1e7), 16);
  buf.writeInt32BE(Math.round(-122.4194 * 1e7), 20);
  buf.writeFloatBE(112.5, 24);
  buf.writeUInt8(87, 28);
  buf.writeUInt8(0b0001_0011, 29); // Armed|GPS Lock, Mode=run
  buf.writeUInt16BE(0xbeef, 30);
  fs.writeFileSync(path.join(OUT, 'telemetry.pkt'), buf);
}

// --- nested.fw : matches "Nested Firmware (example)" / examples/formats/nested-firmware.json ---
{
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(0x00015746, 0); // Magic "FW\x01\x00"
  buf.writeUInt16LE(0x0107, 4); // Version 1.7
  buf.writeUInt16LE(0b0000_0000_0001_0011, 6); // Flags: Compressed|Signed, Stage=app(1)
  buf.writeUInt32LE(20480, 8); // ImageInfo.ImageSize
  buf.writeUInt32LE(0x08000000, 12); // ImageInfo.LoadAddress
  buf.writeUInt32LE(0x08000131, 16); // ImageInfo.EntryPoint
  buf.writeUInt32LE(0xdeadbeef, 20); // Checksum
  for (let i = 24; i < buf.length; i++) buf[i] = (i * 17) & 0xff;
  fs.writeFileSync(path.join(OUT, 'nested.fw'), buf);
}

// --- sample.wav : matches "WAV / RIFF Header" ---
{
  const dataBytes = 800;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buf.writeUInt16LE(1, 20); // AudioFormat = PCM
  buf.writeUInt16LE(2, 22); // NumChannels = stereo
  buf.writeUInt32LE(44100, 24); // SampleRate
  buf.writeUInt32LE(44100 * 2 * 2, 28); // ByteRate
  buf.writeUInt16LE(4, 32); // BlockAlign
  buf.writeUInt16LE(16, 34); // BitsPerSample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < dataBytes; i += 2) buf.writeInt16LE(Math.round(3000 * Math.sin(i / 6)), 44 + i);
  fs.writeFileSync(path.join(OUT, 'sample.wav'), buf);
}

// --- disk.mbr : matches "MBR Partition Table" ---
{
  const buf = Buffer.alloc(512);
  for (let i = 0; i < 446; i++) buf[i] = (i * 73) & 0xff; // bootstrap filler
  const part = (off, status, type, lba, count) => {
    buf.writeUInt8(status, off);
    buf.writeUInt8(0xfe, off + 1); buf.writeUInt8(0xff, off + 2); buf.writeUInt8(0xff, off + 3); // CHS first
    buf.writeUInt8(type, off + 4);
    buf.writeUInt8(0xfe, off + 5); buf.writeUInt8(0xff, off + 6); buf.writeUInt8(0xff, off + 7); // CHS last
    buf.writeUInt32LE(lba, off + 8);
    buf.writeUInt32LE(count, off + 12);
  };
  part(446, 0x80, 0x0c, 2048, 204800); // bootable FAT32 (LBA), 100 MiB
  part(462, 0x00, 0x83, 206848, 2097152); // Linux, 1 GiB
  part(478, 0x00, 0x00, 0, 0);
  part(494, 0x00, 0x00, 0, 0);
  buf.writeUInt16LE(0xaa55, 510);
  fs.writeFileSync(path.join(OUT, 'disk.mbr'), buf);
}

// --- flash.fls : 128 KiB blob for the "MCU Flash Layout" sections example ---
{
  const buf = Buffer.alloc(0x20000);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 191 + (i >> 7) * 13) & 0xff;
  buf.fill(0xff, 0x1e000, 0x1f000); // "Reserved" region left erased
  buf.write('MFG:SN=AB12CD34:REV=C', 0x1f000, 'ascii');
  fs.writeFileSync(path.join(OUT, 'flash.fls'), buf);
}

// --- sensor.slog : matches "Sensor Log" (reusable "Sample" structure) ---
{
  const N = 32;
  const buf = Buffer.alloc(8 + N * 8);
  buf.write('SLOG', 0, 'ascii');
  buf.writeUInt16LE(1, 4); // Version
  buf.writeUInt16LE(N, 6); // SampleCount
  for (let i = 0; i < N; i++) {
    const o = 8 + i * 8;
    buf.writeUInt32LE(1000 + i * 25, o); // timestamp
    buf.writeUInt8(i % 4, o + 4); // channel
    buf.writeUInt8(0x01 | (i % 3 === 0 ? 0x02 : 0) | ((i % 3) << 4), o + 5); // flags: valid, maybe clipped, range
    buf.writeInt16LE(Math.round(2000 * Math.sin(i / 3)), o + 6); // value
  }
  fs.writeFileSync(path.join(OUT, 'sensor.slog'), buf);
}

// --- sample.dat : arbitrary binary, no matching format (raw-mode demo) ---
{
  const buf = Buffer.alloc(4096);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 131 + (i >> 5)) & 0xff;
  buf.write('The quick brown fox jumps over the lazy dog. ', 0x100, 'ascii');
  buf.write('BINARY VIEWER DEMO', 0x400, 'ascii');
  fs.writeFileSync(path.join(OUT, 'sample.dat'), buf);
}

console.log('Wrote example binaries to', OUT);
