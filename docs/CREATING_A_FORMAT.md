# Creating a binary format — a walkthrough

This builds a format for a **WAV file header** from scratch, using the shipped
`examples/binaries/sample.wav`. The finished result is
[`examples/formats/wav-header.json`](../examples/formats/wav-header.json).

A format definition is plain JSON. There is no expression language and nothing in
it is executed — see the [schema reference](FORMAT_DEFINITIONS.md) for every
option.

---

## 1. Open the file and read the bytes

Right-click `sample.wav` → **Open With… → Binary Viewer**. In **Raw** mode you
see:

```
Offset     00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F   ASCII
00000000   52 49 46 46 4C 03 00 00  57 41 56 45 66 6D 74 20   RIFFL...WAVEfmt
00000010   10 00 00 00 01 00 02 00  44 AC 00 00 10 B1 02 00   ........D.......
00000020   04 00 10 00 64 61 74 61  20 03 00 00 ...            ....data ...
```

Two things jump out:

- **`RIFF`** at offset 0 and **`WAVE`** at offset 8 — good magic bytes.
- The layout is a header followed by two *sub-chunks*: `fmt ` (starting at
  offset 12) and `data` (starting at offset 36).

## 2. Start the editor

Command palette → **Binary Viewer: Create Binary Format**. Fill in:

| Field | Value |
| --- | --- |
| Name | `WAV / RIFF Header` |
| Default Endianness | `Little Endian` (WAV is little-endian) |
| File Extensions | `.wav` |
| Magic Offset / Magic Bytes | `0` / `52 49 46 46` (ASCII "RIFF") |

## 3. Add the top-level fields

Click **+ Add Field** three times and set:

| Name | Type | Offset | Length |
| --- | --- | --- | --- |
| `ChunkID` | `ascii` | `0` | `4` |
| `ChunkSize` | `uint32` | `4` | |
| `Format` | `ascii` | `8` | `4` |

The **JSON Preview** pane updates live and the **Validation** pane turns green.

## 4. Add the first nested structure

The `fmt ` sub-chunk is its own little record. Click **+ Add Structure**:

- Name it `fmt chunk`, Offset `12`.
- Now click **+ Field** *inside that structure*. **Offsets of child fields are
  relative to the structure**, so you write `0`, `4`, `8`, … not `12`, `16`, …:

| Name | Type | Offset (relative) | Notes |
| --- | --- | --- | --- |
| `SubchunkID` | `ascii` (len 4) | `0` | `"fmt "` |
| `SubchunkSize` | `uint32` | `4` | 16 for PCM |
| `AudioFormat` | `enum` (size 2) | `8` | see below |
| `NumChannels` | `uint16` | `10` | |
| `SampleRate` | `uint32` | `12` | |
| `ByteRate` | `uint32` | `16` | |
| `BlockAlign` | `uint16` | `20` | |
| `BitsPerSample` | `uint16` | `22` | |

For `AudioFormat`, open the field's **advanced** disclosure and paste:

```json
{ "enum": { "1": "PCM", "3": "IEEE float", "6": "A-law", "7": "mu-law", "65534": "extensible" } }
```

You don't have to give the structure a **Size** — leave it `auto` and it is
computed from the largest child end (`22 + 2 = 24`).

## 5. Add the second nested structure

**+ Add Structure** → `data chunk`, Offset `36`, then **+ Field** inside it:

| Name | Type | Offset (relative) |
| --- | --- | --- |
| `SubchunkID` | `ascii` (len 4) | `0` |
| `SubchunkSize` | `uint32` | `4` |

## 6. Save and use it

Click **Save**. The format is written to your global storage as JSON. Back in the
open `sample.wav`, the **Format** dropdown now lists *WAV / RIFF Header*
(marked `(detected)` because the extension and magic both match). Switch to the
**Structure** tab:

```
▼ WAV / RIFF Header
  ChunkID                0x00000000  ascii[4]   "RIFF"
  ChunkSize              0x00000004  uint32     844
  Format                 0x00000008  ascii[4]   "WAVE"
  ▼ fmt chunk            0x0000000C  struct     24 bytes
      SubchunkID         0x0000000C  ascii[4]   "fmt "
      SubchunkSize       0x00000010  uint32     16
      AudioFormat        0x00000014  enum       PCM (1)
      NumChannels        0x00000016  uint16     2
      SampleRate         0x00000018  uint32     44100 Hz
      ...
  ▼ data chunk           0x00000024  struct     8 bytes
      SubchunkID         0x00000024  ascii[4]   "data"
      SubchunkSize       0x00000028  uint32     800 bytes
```

Click **SampleRate** — the raw view highlights bytes `0x18..0x1B` and the
breadcrumb shows `WAV / RIFF Header › fmt chunk › SampleRate`.

## 7. Reuse it

Copy the JSON into a repo at `.vscode/binary-viewer/formats/wav-header.json` and
everyone who opens a `.wav` in that workspace gets the decode for free. Workspace
formats override global ones of the same name.

---

## More patterns to copy

| Example | Teaches |
| --- | --- |
| [`wav-header.json`](../examples/formats/wav-header.json) | nested sub-chunks, `enum`, ASCII tags, `unit` |
| [`nested-firmware.json`](../examples/formats/nested-firmware.json) | multi-level nesting, a bit-field inside a nested struct, `timestamp` |
| [`mbr.json`](../examples/formats/mbr.json) | an **array of nested structures**, magic at a non-zero offset (`55 AA` @ 510) |
| [`flash-layout.json`](../examples/formats/flash-layout.json) | a **sections-only** memory map for the Sections view — `start` / `length` / `flags` / `display` |
| [`firmware.json`](../examples/formats/firmware.json) | `flags` with an enum sub-field, `timestamp`, scaled size |
| [`eeprom.json`](../examples/formats/eeprom.json) | big-endian, `bytes[6]` MAC address, `scale`/`bias`/`unit` calibration, 32-bit flags |
| [`packet.json`](../examples/formats/packet.json) | network byte order, 64-bit millisecond timestamp, status bit-field |

Matching binaries for each live in [`examples/binaries/`](../examples/binaries/).

## Tips

- **Leave `offset` blank** to pack a field straight after the previous sibling.
- A field is **either** a `type` (primitive) **or** a `fields` array (structure) —
  never both. The one exception is the bit-field form
  `{ "type": "uint8", "fields": [ { "name": "...", "bits": "0" } ] }`.
- The editor's **advanced** box merges any extra JSON onto a primitive field —
  use it for `enum`, `items` (array element), `timestamp`, `scale`/`bias`, or the
  bit-field `fields` array.
- If the Structure view shows `<reads past end of file>` on a field, its
  `offset` + size is beyond the file — check the offsets against the hex view.
- Use **Binary Viewer: Import / Export Binary Format** to move definitions
  between machines.
- Add a top-level `sections` array (`{ name, start, length, flags?, display? }`)
  for the **Sections** tab's memory-map table — see
  [FORMAT_DEFINITIONS.md](FORMAT_DEFINITIONS.md#sections-memory-map). `fields` is
  optional when `sections` is present.
