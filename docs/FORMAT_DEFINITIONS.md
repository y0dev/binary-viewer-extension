# Binary Format Definitions

A format definition is a **plain JSON object**. There is no expression language
and nothing in a definition is ever executed — an invalid or hostile file can
only describe a wrong layout.

> New to this? The [**Creating a binary format**](CREATING_A_FORMAT.md)
> walkthrough builds one field-by-field in the editor against a real file.

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
  "fields": [ /* FieldDefinition[] */ ],   // fields OR sections must be present
  "sections": [ /* SectionDefinition[] */ ] // optional, memory-map view
}
```

A format must define a non-empty `fields` array, a non-empty `sections` array,
or both. A `sections`-only format is a pure memory map.

### Magic detection

```jsonc
"magic": { "offset": 0, "bytes": "46 57 01 00" }
"magic": { "offset": 0, "bytes": "46 50", "mask": "FF F0" }   // masked compare
"magic": [ { "offset": 0, "bytes": "89 50 4E 47" },
           { "offset": 0, "bytes": "FF D8 FF" } ]             // any-of
```

`bytes` / `mask` accept space- or comma-separated hex, with or without `0x`.

**Loading & precedence.** Definitions are read from three places — builtin,
global storage (`<globalStorage>/binary-viewer/formats/*.json`) and the
workspace (`.vscode/binary-viewer/formats/*.json`, trusted workspaces only). A
workspace file **shadows** a global/builtin one that collides with it **by
format `name` or by JSON file name**. All three locations are watched, so new /
edited / deleted files are picked up automatically (or via **Reload Binary
Formats** / the ↻ button).

**Detection order** when a file is opened:
1. workspace formats, then global, then builtin
2. a format is a candidate if its extension matches **or** a magic entry matches
3. a format that declares `magic` but none match is **disqualified**
4. score: magic + extension > magic > extension; ties → alphabetical
5. one match → applied automatically; several → you pick; none → Raw mode only

## Nested structures

A field is **either** a primitive (`type`) **or** a nested structure (`fields`),
never both. A field with a `fields` array and **no `type`** is a container:

```jsonc
{
  "name": "Header",
  "offset": 0,          // absolute here (top level)
  "fields": [
    { "name": "Magic",   "type": "uint32", "offset": 0 },  // offset RELATIVE to Header
    { "name": "Version", "type": "uint16", "offset": 4 },
    { "name": "Flags",   "type": "uint16", "offset": 6 }
  ]
}
```

- **Child offsets are relative to the enclosing structure.** The parser adds the
  parent's absolute offset automatically — you never compute absolute offsets by
  hand. Omit a child `offset` to pack it after the previous sibling.
- **Nesting is unlimited** — structures inside structures inside structures.
- **`size`** on a structure is optional. When given it is the structure's total
  size; when omitted it is the largest child end offset. Nested structures feed
  their computed size into the parent's calculation.
- The Structure view shows containers with a disclosure arrow (expand/collapse,
  remembered for the session) and a breadcrumb such as
  `Firmware › Header › ImageInfo › LoadAddress`. Selecting a container highlights
  its whole byte range in the raw view; selecting a leaf highlights just that
  field.
- `type: "struct"` is still accepted for backward compatibility and behaves
  identically to the typeless form.
- Flat and nested fields can be freely mixed at any level. Existing flat format
  definitions keep working unchanged.

Validation rejects, with a clear message:

- a field with **both** `type` and `fields` (except the bit-field form);
- a field with **neither** `type` nor `fields`;
- a negative structure or child `offset`;
- **overlapping** fields within a structure;
- a field that **extends beyond** a structure's declared `size`;
- an empty structure.

## Reusable structures

Define a record layout once under a top-level `structures` map, then set a
field's (or an array element's) `"type"` to the structure's name. The extension
inlines it before parsing, so it behaves exactly like an inline nested
structure — this is the easy way to describe a **large array of records**:

```jsonc
{
  "name": "Sensor Log",
  "endianness": "little",
  "structures": {
    "Sample": {
      "fields": [
        { "name": "timestamp", "type": "uint32", "offset": 0 },
        { "name": "channel",   "type": "uint8",  "offset": 4 },
        { "name": "value",     "type": "int16",  "offset": 6 }
      ]
    }
  },
  "fields": [
    { "name": "count",   "type": "uint32", "offset": 0 },
    { "name": "samples", "type": "array",  "offset": 4,
      "count": 100000, "items": { "name": "sample", "type": "Sample" } }
  ]
}
```

- A `structures` entry is `{ "fields": [...], "size"?, "endianness"?, "description"? }`.
  Child offsets are relative to the structure, like any nested structure.
- A structure may reference another structure; **cycles are rejected** with a
  clear error, as are references to an undefined name.
- `structures` is optional and adds nothing to the wire protocol — it is
  resolved to inline `fields` before parsing.

## FieldDefinition

| Property | Applies to | Meaning |
| --- | --- | --- |
| `name` | all | required label |
| `type` | primitives only | see the type table below. **Omit** for a nested structure |
| `fields` | structure | nested `FieldDefinition[]`; child offsets are **relative** to this structure |
| `offset` | all | byte offset — absolute at the top level, **relative to the parent** inside a structure. **Omit** to pack immediately after the previous sibling |
| `size` | structure, `bytes`,`binary`,`padding`,`enum`,`flags`, any scalar | explicit byte width (structure: total size; omitted ⇒ computed from children) |
| `length` | strings, `char` | number of characters / code units |
| `count` | `array` | element count |
| `items` | `array` | element `FieldDefinition` (its `name`/`offset` are ignored) |
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

See [`examples/formats/`](../examples/formats/) for worked definitions —
`wav-header.json` (nested RIFF sub-chunks), `nested-firmware.json` (multi-level
nesting + a `sections` array), `mbr.json` (an array of nested structs, magic at
offset 510), `sensor-log.json` (a reusable `structures` map for an array of
records), `flash-layout.json` (a sections-only memory map), `firmware.json`
(`flags` + timestamp), `eeprom.json` (big-endian, MAC address, scaled
calibration) and `packet.json` (network-order telemetry, 64-bit ms timestamp) —
plus matching files in [`examples/binaries/`](../examples/binaries/).

## Ways to build a definition

| Route | When |
| --- | --- |
| **Binary Viewer: Generate Binary Format From File** | fastest start — scaffolds a whole-file skeleton, or a computed `array` from a selection (large repeating data). See [CREATING_A_FORMAT.md](CREATING_A_FORMAT.md). |
| **Binary Viewer: Create / Edit Binary Format** (form editor) | visual, tree-based, with live validation |
| Hand-write the JSON | full control; use the **✓ Validate** / **↻ Apply** editor-title buttons |

### The form editor

Fields and structures are edited as a **tree**. Each row has Name, Offset,
Size, and (for primitives) Type / Length / Endianness. Use:

- **`+ Add Field`** / **`+ Add Array`** / **`+ Add Structure`** at the top level,
  and the same three inside every structure;
- **Reusable structures** — a top-level section with **`+ Add Structure
  Definition`**. Any structure you define here appears in every type dropdown
  (grouped under *structures*), so an array of records is just
  `+ Add Array` → count → pick the structure as the element type;
- **↑ / ↓** reorder within the same parent, **⧉** duplicates a row (and its
  whole subtree), **⇥** / **⇤** move a field into / out of the structure above;
- the **▶/▼** toggle collapses a structure while editing;
- the **Sections (memory map)** box takes a raw JSON `sections` array (with an
  "insert example section" helper).

A live JSON preview shows the exact object that will be saved, and the
validation panel lists overlap / offset / size / "type-or-fields" / structure-
reference errors as you type.

Extra properties for `flags`/`bitfield`/`enum`/`timestamp` go in a primitive
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

## Sections (memory map)

An optional top-level `sections` array powers the **Sections** tab — a
memory-map table with `Section · Start · End · Length` and two optional,
user-defined columns.

```jsonc
"sections": [
  { "name": "main",   "start": "0x0000", "length": "0x4000", "flags": "r-x", "display": true },
  { "name": "config", "start": "0x4000", "end": "0x5000",    "flags": "rw-", "display": true },
  { "name": "scratch (RAM)", "start": "0x20000000", "length": 1024, "flags": "rw-", "display": false }
]
```

| Property | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Section title, e.g. `main`, `.text`, `Bootloader` |
| `start` | yes | Start address / file offset. Number or string — `"0x8000"`, `"4096"`, `"1000h"` |
| `length` | one of `length`/`end` | Size in bytes (number or hex string) |
| `end` | one of `length`/`end` | Exclusive end address; used when `length` is absent |
| `flags` | no | Free-form permission string (`rwx`, `r-x`, `rw-`, `---`). Shows the **Flags** column only when at least one section sets it |
| `display` | no | `true` / `false`. Shows a **Display** column (`Yes`/`No`); `false` rows render struck-through and can be hidden with the tab's checkbox |
| `description` | no | Tooltip text |

Behaviour:

- Rows are sorted by `start`. Clicking a row selects `[start, start + length)` in
  the raw view (double-click also switches to Raw). A row whose `start` is past
  the end of the file is shown but not selectable.
- **No `sections` key?** The tab still works — it derives one row per top-level
  field (name, offset, size), marked *derived*.
- `fields` is optional when `sections` is present, so a definition can be a pure
  memory map. See [`examples/formats/flash-layout.json`](../examples/formats/flash-layout.json).

## Future-proofing

The schema already carries the shape for nested structures, arrays,
variable-length data, calculated/checksum fields, pointer/address fields,
enum/register definitions and the `sections` memory map. Planned importers
(C `struct`, DWARF, ELF, S-record, Intel HEX) and features (conditional/dynamic
offsets, CRC validation) are additive — they become new `type` handlers, never a
code-execution hook.

**Reusable named structures** (a future feature) would add a top-level
`structures` map and let a field reference one by `"type": "<StructName>"`:

```jsonc
{
  "structures": { "ImageInfo": { "fields": [ /* ... */ ] } },
  "fields": [ { "name": "ImageInfo", "type": "ImageInfo" } ]
}
```

The recursive parser and `computeFieldSize` already handle inline nested
structures, so this only needs a *resolver pass* that expands each named
reference into an inline `fields` array before parsing — no change to the
parser or the message protocol. **(Implemented — see "Reusable structures"
above.)**
