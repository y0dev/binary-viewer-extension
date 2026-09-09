# Binary Format Definitions

A format definition is a **plain JSON object**. There is no expression language
and nothing in a definition is ever executed — an invalid or hostile file can
only describe a wrong layout.

## Top-level shape

```jsonc
{
  "name": "My Firmware Header",        // required, unique — the storage key
  "description": "…",                  // optional
  "version": "1.0.0",                  // optional
  "author": "…",                       // optional
  "fileExtensions": [".fw", ".img"],   // optional, with or without the dot
  "endianness": "little",              // optional, default "little"
  "magic": { "offset": 0, "bytes": "46 57 01 00" },  // optional, see below
  "fields": [ /* FieldDefinition[] */ ] // required, non-empty
}
```

### Magic detection

```jsonc
"magic": { "offset": 0, "bytes": "46 57 01 00" }
"magic": { "offset": 0, "bytes": "46 50", "mask": "FF F0" }   // masked compare
"magic": [ { "offset": 0, "bytes": "89 50 4E 47" },
           { "offset": 0, "bytes": "FF D8 FF" } ]             // any-of
```

`bytes` / `mask` accept space- or comma-separated hex, with or without `0x`.

**Detection order** when a file is opened:
1. workspace formats, then global, then builtin
2. a format is a candidate if its extension matches **or** a magic entry matches
3. a format that declares `magic` but none match is **disqualified**
4. score: magic + extension > magic > extension; ties → alphabetical
5. one match → applied automatically; several → you pick; none → Raw mode only

## FieldDefinition

| Property | Applies to | Meaning |
| --- | --- | --- |
| `name` | all | required label |
| `type` | all | see the type table below |
| `offset` | all | absolute byte offset. **Omit** to pack immediately after the previous sibling |
| `size` | `bytes`,`binary`,`padding`,`enum`,`flags`, any scalar | explicit byte width |
| `length` | strings, `char` | number of characters / code units |
| `count` | `array` | element count |
| `items` | `array` | element `FieldDefinition` (its `name`/`offset` are ignored) |
| `fields` | `struct` | nested `FieldDefinition[]` (offsets **relative** to the struct) |
| `fields` | `flags`,`bitfield` | `BitSpec[]` — `{ name, bits, description?, enum?, boolean? }` |
| `endianness` | scalars & multi-byte composites | `"little"` / `"big"` override |
| `enum` | `enum` + any integer scalar | value→label map or `[{value,name}]` |
| `timestamp` | `timestamp` | `{ size?: 4|8, unit?: "s"|"ms", epoch?: "unix"|"y2k"|<ms> }` |
| `display` | integer scalars | `"hex"` / `"dec"` / `"bin"` / `"auto"` |
| `scale`, `bias` | numeric scalars | shown value = `raw * scale + bias` |
| `unit` | numeric scalars | label appended to the value (`"mV"`, `"°C"`) |
| `description` | all | shown on hover / in the inspector |

## Data types

### Integer
`uint8 int8 uint16 int16 uint32 int32 uint64 int64`
(`uint64`/`int64` are read as BigInt and displayed in decimal + hex.)

### Floating point
`float32` (`float`), `float64` (`double`)

### Raw
- `byte` — alias for `uint8`
- `bytes` / `hex` — raw run of `size` bytes, shown as hex
- `binary` — raw run of `size` bytes, shown as bit strings
- `padding` — `size` bytes, skipped in the display

### Character / string
- `char` — one byte as a character; with `length`/`count` it becomes `char[N]`
- `ascii` / `string` — fixed `length` bytes, non-printable → `.`, trimmed at NUL
- `utf8` — `length`/`size` bytes decoded as UTF-8
- `utf16` — `length` code units (or `size` bytes) decoded as UTF-16 (endian-aware)

### Other
- `boolean` — one byte, `true` if non-zero
- `enum` — integer of `size` bytes (default 4) mapped through `enum`
- `flags` / `bitfield` — integer container of `size` bytes broken into bits
- `timestamp` — integer epoch converted to an ISO-8601 string
- `struct` — nested record; `fields` offsets are relative to the struct's start
- `array` — `count` elements of `items`

## Bit fields

```jsonc
{
  "name": "Status",
  "type": "flags",
  "offset": 6,
  "size": 1,
  "fields": [
    { "name": "Enabled",  "bits": "0" },
    { "name": "Mode",     "bits": "1-3", "enum": { "0": "idle", "1": "run", "2": "safe" } },
    { "name": "Error",    "bits": "4" },
    { "name": "Reserved", "bits": "5-7" }
  ]
}
```

- **Bit 0 is the LSB.** `"bits"` is `"N"` or `"N-M"` (inclusive, order-insensitive).
- 1-bit ranges render as `true`/`false` unless you set `"boolean": false`.
- The container is read with the field's (or format's) endianness. `size` may be
  1, 2, 4 or 8.
- The editor and loader reject overlapping ranges and ranges past the container
  width.

Rendered as:

```
Status: 0x15   00010101
Bit  7  6  5  4  3  2  1  0
     0  0  0  1  0  1  0  1
  bit 0    Enabled   true
  bit 3-1  Mode      2
  bit 4    Error     true
```

## Worked example

```jsonc
{
  "name": "Firmware Image",
  "fileExtensions": [".fw", ".img"],
  "endianness": "little",
  "magic": { "offset": 0, "bytes": "46 57 01 00" },
  "fields": [
    { "name": "Magic",        "type": "ascii",  "offset": 0,  "length": 2 },
    { "name": "Version",      "type": "uint16", "offset": 4 },
    { "name": "Flags",        "type": "uint16", "offset": 6, "display": "hex" },
    { "name": "Image Size",   "type": "uint32", "offset": 8, "display": "dec", "unit": "bytes" },
    { "name": "Load Address", "type": "uint32", "offset": 12, "display": "hex" },
    { "name": "Built",        "type": "timestamp", "offset": 16,
      "timestamp": { "size": 4, "unit": "s", "epoch": "unix" } },
    { "name": "CRC",          "type": "uint32", "offset": 20, "display": "hex" }
  ]
}
```

See [`examples/formats/`](../examples/formats/) for `firmware.json`,
`eeprom.json` (big-endian, MAC address, scaled calibration values) and
`packet.json` (network-order telemetry with a 64-bit millisecond timestamp), and
[`examples/binaries/`](../examples/binaries/) for files that match them.

## Composite fields in the form editor

The form editor shows one row per field with the common columns. Extra
properties for `flags`/`bitfield`/`enum`/`array`/`struct`/`timestamp` go in the
row's **advanced** disclosure as a JSON fragment that is merged onto the field,
e.g.:

```jsonc
{ "fields": [ { "name": "Enabled", "bits": "0" }, { "name": "Mode", "bits": "1-3" } ] }
```
```jsonc
{ "enum": { "0": "off", "1": "on", "2": "auto" } }
```
```jsonc
{ "items": { "name": "sample", "type": "uint16" } }
```

The live JSON preview always shows the exact object that will be saved.

## Future-proofing

The schema already carries the shape for nested structures, arrays,
variable-length data, calculated/checksum fields, pointer/address fields and
enum/register definitions. Planned importers (C `struct`, DWARF, ELF, S-record,
Intel HEX) and features (conditional/dynamic offsets, CRC validation, memory-map
visualization) are additive — they become new `type` handlers, never a
code-execution hook.
