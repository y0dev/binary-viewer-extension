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
  "baseAddress": "0x08000000",         // optional — offset columns shown relative to this
  "magic": { "offset": 0, "bytes": "46 57 01 00" },  // optional, see below
  "constants": { "Rows": 4, "Total": "Rows + 1" },   // optional, see "Constants" below
  "fields": [ /* FieldDefinition[] */ ],   // fields OR sections must be present
  "sections": [ /* SectionDefinition[] */ ] // optional, memory-map view
}
```

A format must define a non-empty `fields` array, a non-empty `sections` array,
or both. A `sections`-only format is a pure memory map.

### Base address

`baseAddress` (a number, or a `"0x…"` / decimal / `"…h"` string) shifts every
offset / address shown in the hex view, Structure table, Sections table, status
bar and Go To — handy when the file is memory-mapped (e.g. `0x08000000` for
internal flash) so addresses match the datasheet or linker map. It overrides the
`binaryViewer.baseAddress` setting for this format. Field `offset`s in the
definition are still written from `0` (the start of the file).

### Magic detection

```jsonc
"magic": { "offset": 0, "bytes": "46 57 01 00" }
"magic": { "offset": 0, "bytes": "46 50", "mask": "FF F0" }   // masked compare
"magic": [ { "offset": 0, "bytes": "89 50 4E 47" },
           { "offset": 0, "bytes": "FF D8 FF" } ]             // any-of
```

`bytes` / `mask` accept space- or comma-separated hex, with or without `0x`.

**Loading & precedence.** Definitions are read from four places, lowest priority
first:

1. **builtin** — shipped examples (hide them with `binaryViewer.showBuiltinFormats: false`);
2. **global storage** — `<globalStorage>/.../formats/*.json` (where the editor and
   *Generate* save);
3. **external** — every folder listed in `binaryViewer.formatDirectories` (a
   shared network drive, another machine — `~` and `${workspaceFolder}` are
   expanded);
4. **workspace** — `.vscode/binary-viewer/formats/*.json`, trusted workspaces only.

A higher source **shadows** a lower one that collides with it **by format `name`
or by JSON file name**. Every location is watched, so new / edited / deleted
files are picked up automatically (or via **Reload Binary Formats** / the ↻
button). The Format dropdown tags each entry `[workspace]` / `[external]` /
`[builtin]`.

**Detection order** when a file is opened:
1. workspace, then external, then global, then builtin
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

### More ways to use a structure

```jsonc
{
  "structures": {
    "Vec3":   { "fields": [
      { "name": "x", "type": "float32", "offset": 0 },
      { "name": "y", "type": "float32", "offset": 4 },
      { "name": "z", "type": "float32", "offset": 8 } ] },
    "Pose":   { "fields": [
      { "name": "position", "type": "Vec3", "offset": 0 },   // struct inside a struct
      { "name": "velocity", "type": "Vec3", "offset": 12 } ] }
  },
  "fields": [
    { "name": "origin",    "type": "Vec3",     "offset": 0 },   // a single record
    { "name": "waypoints", "type": "Vec3[64]", "offset": 12 },  // array shorthand (see below)
    { "name": "path",      "type": "array", "offset": 780,
      "count": 8, "items": { "name": "p", "type": "Pose" } }    // explicit array form
  ]
}
```

## Constants

A top-level `constants` map defines named values a field can reference by
name — most usefully as an array's `countField`, for a fixed size that isn't
decoded from the file:

```jsonc
{
  "name": "Grid",
  "constants": {
    "Rows": 4,
    "Cols": 8,
    "Total": "Rows + Cols"   // a "+"-separated sum of other constants/numbers
  },
  "fields": [
    { "name": "cell", "type": "array", "offset": 0,
      "countField": "Rows", "items": { "name": "v", "type": "uint8" } }
  ]
}
```

- A value is a plain number, or a string summing named constants and/or
  literal integers with `+` (e.g. `"Mean + Range"`, `"Rows + 1"`). That's the
  only operation supported — it stays declarative data, never code to
  execute. A constant may reference another constant; cycles are rejected. A
  name can contain spaces (`"Number of Dogs"`) — it just can't contain a
  literal `+`.
- **A constant is fixed at format-authoring time — it never sees decoded file
  bytes.** If the values you want to add are themselves fields in the file
  (e.g. a header stores "number of dogs" and "number of cats" as bytes), don't
  put them in `constants` — sum the **field names** directly in `countField`
  instead (see below). `constants` is for a size the format author picked
  ahead of time, not one read from the file.
- The form editor has its own **Constants** section (above *Reusable
  structures*) for defining these without touching JSON.

## Array shorthand — `type: "<base>[<n>]"`

Any type may be written as `<base>[<n>]` to mean "a fixed run of *n*":

| Shorthand | Expands to |
| --- | --- |
| `"float32[8]"` | `{ "type": "array", "count": 8, "items": { "type": "float32" } }` |
| `"int16[24]"` | array of 24 `int16` |
| `"Sample[100]"` | array of 100 of the reusable structure `Sample` |
| `"char[4]"` | a 4-character string (`{ "type": "char", "length": 4 }`) |
| `"ascii[16]"` / `"utf16[8]"` | fixed-length string of that many code units |
| `"bytes[12]"` / `"binary[8]"` | `{ "type": "bytes"/"binary", "size": N }` |

It works anywhere a `type` does — a top-level field, a structure field, or an
array's `items`. It also chains for a nested array — `"int16[4][3][2]"` is a
2×3×4 grid of `int16` (the rightmost bracket is the outermost dimension). The
form editor's **+ Add Array** produces the same thing and round-trips
shorthand you type by hand, including a chained element type (e.g. typing
`"int16[4][3]"` as the element type of a count-2 array) up to 3 dimensions
total — deeper nesting, or an array of an inline structure, needs the JSON tab.

In the Structure view, every level of a nested array shows the full remaining
shorthand chain as its type label, not just the word "array" — for a 3D
`vol[2][3][4]` of `int16`, the `vol` row reads `int16[4][3][2]`, each `vol[i]`
"plane" row reads `int16[4][3]`, and each `vol[i][j]` "row" row reads
`int16[4]`, so you can tell at a glance what a collapsed level actually holds.
A level sized by `countField` shows `?` in place of the count it doesn't know
yet (e.g. `uint8[? ← rows][2]`).

## Pointer-style offsets — `offsetField`

Some formats store an offset *inside the file itself* that points to another
part of the file — common in bootloader/firmware headers. The Xilinx Zynq
MPSoC `BOOT.BIN` is a good example: the boot header has a 32-bit
"Image Header Table Offset" field, and the actual Image Header Table lives
wherever that value points, not at a fixed spot:

```jsonc
{
  "name": "Zynq MPSoC BOOT.BIN (partial)",
  "endianness": "little",
  "fields": [
    { "name": "Width Detection Word", "id": "widthWord", "type": "uint32", "offset": 0 },
    { "name": "Image Header Table Offset", "id": "ihtOffset", "type": "uint32", "offset": 0x24 },
    {
      "name": "Image Header Table",
      "offsetField": "ihtOffset",
      "fields": [
        { "name": "Version", "type": "uint32", "offset": 0 }
      ]
    }
  ]
}
```

`Image Header Table` has no `offset` — its position comes from the *decoded
value* of the `Image Header Table Offset` field at parse time. Like
`countField`, `offsetField` is a `"+"`-separated sum of terms — a literal
integer, a `constants` entry, or an earlier decoded field by `id` or `name` —
so it can also add a fixed base (`"ihtOffset + 4"`) if the pointer needs
adjusting. Unlike a plain `offset`, it is always **absolute** from the start
of the file, even inside a nested structure, since a pointer's value doesn't
care which structure happens to contain the field that stores it. A struct
containing an `offsetField` child should usually get an explicit `size`, for
the same reason a `countField` array's enclosing struct should — the child's
real position isn't known until parse time. The decode window widens to the
whole file (capped, same as `countField`) whenever a format uses `offsetField`,
so the pointed-to bytes are actually available to read.

`id` is what makes long, descriptive field names practical to reference —
`"Width Detection Word"` is a mouthful to retype into a `countField` or
`offsetField` box, so give it a short `id` (`"widthWord"`) and reference that
instead. Referencing by `name` still works exactly as before (that's what
every existing format already does); `id` is purely an additional option,
checked first. IDs must be unique across the whole format.

## FieldDefinition

| Property | Applies to | Meaning |
| --- | --- | --- |
| `name` | all | required label |
| `id` | all | short, stable identifier for referencing this field from a `countField`/`offsetField` elsewhere — an alternative to typing out `name` (handy when `name` is a long display label). Referencing by `name` keeps working too; must be unique across the format |
| `type` | primitives only | see the type table below. **Omit** for a nested structure |
| `fields` | structure | nested `FieldDefinition[]`; child offsets are **relative** to this structure |
| `offset` | all | byte offset — absolute at the top level, **relative to the parent** inside a structure. **Omit** to pack immediately after the previous sibling |
| `offsetField` | all | a `"+"`-sum of terms (same syntax as `countField`) to take this field's position from instead of `offset`/packing — always an **absolute** file offset regardless of nesting, for pointer-style formats. `offset`, when present, wins |
| `size` | structure, `bytes`,`binary`,`padding`,`enum`,`flags`, any scalar | explicit byte width (structure: total size; omitted ⇒ computed from children) |
| `sizeAlign` | structure (or a reusable-structure reference) | round the auto-computed structure size up to this many bytes; no effect when `size` is also set |
| `length` | strings, `char` | number of characters / code units |
| `terminator` | `cstring` | ending byte value, 0-255 (default `0`) |
| `wordSize` | `cstring` | group bytes into `wordSize`-byte chunks and reverse each before scanning, then scan for the terminator (default `1`, no grouping) |
| `maxLength` | `cstring` | give up scanning for the terminator after this many bytes (default `1024`) |
| `count` | `array` | fixed element count |
| `countField` | `array` | a `"+"`-separated sum of terms to read the element count from (a single name is just a one-term sum) — each term is a literal integer, a top-level `constants` entry, or an earlier decoded integer field by `id` or `name` (a length prefix); `count` wins if it's also set |
| `items` | `array` | element `FieldDefinition` (its `name`/`offset` are ignored) |
| `view` | `array` | which element indices the Structure view renders — `{ start, end }` (0-based, inclusive) or the shorthand string `"start...end"`; doesn't affect the array's actual count/size/offsets |
| `until` | `array` | `{ field, equals? }` — stop adding elements once the named field (by `id` or `name`) inside the element just parsed equals `equals` (default `0`); the terminating element is included. For a linked-list "next" pointer that's `0` on the last entry |
| `fields` | `flags`,`bitfield` | `BitSpec[]` — `{ name, bits, description?, enum?, boolean? }` |
| `endianness` | scalars & multi-byte composites | `"little"` / `"big"` override |
| `enum` | `enum` + any integer scalar | value→label map or `[{value,name}]` |
| `timestamp` | `timestamp` | `{ size?: 4|8, unit?: "s"|"ms", epoch?: "unix"\|"y2k"\|"gps"\|"mac"\|"filetime"\|<ms> }` |
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
- `cstring` — the only **variable-length** string: scans forward from its
  offset for a `terminator` byte (default `0`), consuming through it. Its
  size isn't known until parse time, same bucket as a `countField` array or
  `offsetField` field — the decode window widens accordingly (see
  [Pointer-style offsets](#pointer-style-offsets--offsetfield)). Options:
  - `terminator?: number` — the ending byte value (0-255). Default `0`.
  - `wordSize?: number` — group bytes into `wordSize`-byte chunks and
    **reverse each chunk** before scanning/decoding, e.g. `4` for a string
    packed as byte-reversed 32-bit words (some Xilinx boot formats pack
    image names this way). The field always consumes whole chunks, so a
    terminator landing mid-chunk still consumes that entire chunk. Default
    `1` (plain byte order — an ordinary C string).
  - `maxLength?: number` — give up with an error if no terminator is found
    within this many bytes, so a non-terminated/corrupt file can't make the
    parser scan forever. Default `1024`.

  ```jsonc
  { "name": "label", "type": "cstring", "offset": 0 },
  { "name": "packed_name", "type": "cstring", "offset": 16, "wordSize": 4, "maxLength": 256 }
  ```

  A structure that contains a `cstring` (or any other parse-time-sized
  field) and needs its *total* size to pad to a fixed boundary regardless of
  the actual content length — common for a record format that pads every
  entry to, say, 64 bytes — sets `sizeAlign` instead of a fixed `size`:
  rounds the structure's auto-computed size up to the next multiple. A field
  positioned via `offsetField` elsewhere in the file never counts toward
  this — it isn't *inside* the structure, however far away it points.

  ```jsonc
  {
    "name": "Record",
    "sizeAlign": 64,
    "fields": [
      { "name": "name", "type": "cstring", "offset": 0, "wordSize": 4 },
      { "name": "terminator", "type": "bytes", "size": 4 }
    ]
  }
  ```

### Other
- `boolean` — one byte, `true` if non-zero
- `enum` — integer of `size` bytes (default 4) mapped through `enum`
- `flags` / `bitfield` — integer container of `size` bytes broken into bits
- `timestamp` — integer converted to a date string. `epoch` selects the origin:
  `unix` (1970, default), `y2k` (2000), `gps` (1980-01-06), `mac` (1904), or
  `filetime` (Windows, 100-ns ticks since 1601); a number is a custom epoch in
  ms. When `epoch` is omitted the `binaryViewer.timestamp.defaultEpoch` setting
  applies. `binaryViewer.timestamp.displayUTC` picks UTC (default) vs local time.
- `struct` — nested record; `fields` offsets are relative to the struct's start
- `array` — `count` elements of `items`; or set `countField` to a `"+"`-sum of
  terms to size the array from. Each term is a literal integer, a `constants`
  entry (see [Constants](#constants) above), or an earlier integer field (in
  the same or an enclosing structure) — checked in that order, term by term:

  ```jsonc
  { "name": "n",      "type": "uint16", "offset": 0 },
  { "name": "values", "type": "array",  "offset": 2,
    "countField": "n", "items": { "name": "v", "type": "float32" } }
  ```

  A single name is just a one-term sum, so this is backward compatible with
  every existing `countField` format. Summing two *decoded* fields — say a
  header stores dog and cat counts separately and you want one array sized by
  the total — needs no `constants` at all, just name both fields:

  ```jsonc
  { "name": "Number of Dogs", "type": "uint8", "offset": 0 },
  { "name": "Number of Cats", "type": "uint8", "offset": 1 },
  { "name": "animals", "type": "array", "offset": 2,
    "countField": "Number of Dogs + Number of Cats",
    "items": { "name": "id", "type": "uint8" } }
  ```

  A following packed field lands after the resolved run. The Structure view's
  `binaryViewer.structure.maxArrayElements` cap still applies, so a corrupt
  prefix can't explode the tree. A struct that *contains* a `countField` array
  should give that struct an explicit `size` (or make the dynamic array its last
  field), since the struct's auto-size can't include a run it doesn't know yet.

  For a large array (50+ elements), set `view` to render just a slice of it in
  the Structure view — either endpoints-inclusive `{ "start": 20, "end": 35 }`,
  or the shorthand string `"20...35"` (either order; missing endpoints default
  to the array's bounds). The array's own `count`/size/offsets are unaffected —
  `view` is purely a display window, and independent of
  `binaryViewer.structure.maxArrayElements` (which still caps how many
  elements a view, or the whole array without one, can render at once). The
  form editor's array rows have their own **view** box for the same shorthand:

  ```jsonc
  { "name": "samples", "type": "array", "offset": 0, "count": 1000,
    "view": "20...35", "items": { "name": "v", "type": "int16" } }
  ```

  For a linked-list-style array — a fixed/max `count` (or `countField`)
  where the *real* number of entries is only known by reading a "next
  pointer" field in each element until it hits a terminator — set `until`.
  `count`/`countField` still act as the safety cap (so a corrupt file can't
  loop forever); `until` stops the array early once it's hit:

  ```jsonc
  {
    "name": "Partition Header Table",
    "type": "array",
    "count": 32,
    "until": { "field": "nextPartitionHeaderOffset" },
    "offsetField": "phtOffset",
    "items": { "name": "item", "type": "PartitionHeader" }
  }
  ```

  `until.field` is matched by `id` or `name` against the element *just
  parsed* — `equals` defaults to `0`. The terminating element is included;
  nothing after it is. If no element ever matches, the array just runs to
  its `count`/`countField`/`maxArrayElements` limit as usual.

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
- **`"bits"` can also be a comma-separated list** (`"0-5,12-13,16-31"`) for a
  field split across non-contiguous positions — common for a catch-all
  "Reserved" spec that fills every leftover bit around several named fields.
  The parts combine into one value, the first-listed part becoming its
  low-order bits; overlap/out-of-range checks apply per part, not the whole
  span, so gaps between parts stay free for other specs to claim.

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
Size, and (for primitives) Type / Length / Endianness — plus, on the row's
second line, an **id** box for a short reference name (see
[Pointer-style offsets](#pointer-style-offsets--offsetfield) above). Use:

- **`+ Add Field`** / **`+ Add Array`** / **`+ Add Structure`** at the top level,
  and the same three inside every structure;
- The **Offset** box (like **Count**) takes a number, or a name/`"+"`-sum to
  size it from — a Constants entry or an earlier field's decoded value,
  referenced by its **id** or its Name;
- An array row's **stop when** box (next to **view**) takes `field` or
  `field=N` — stop the array early once that field (inside the element just
  parsed) equals `N` (default `0`), e.g. a linked-list "next" pointer;
- **Constants** — a top-level section with **`+ Add Constant`** for named
  values (see [Constants](#constants) above); reference one by name in an
  array's Count/CountField or Offset box;
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
