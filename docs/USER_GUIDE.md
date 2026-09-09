# User Guide

## Opening a file

Every binary file works immediately in **Raw** mode — you never have to define a
format just to look at bytes.

- Explorer → right-click a file → **Open With…** → **Binary Viewer**, or
- Command palette → **Binary Viewer: Open With Binary Viewer**, or
- Set a permanent association: **Open With… → Configure default editor for '\*.bin'**.

The extension registers as an *optional* editor for `.bin .hex .img .dat .fw
.rom .dump .raw .eeprom .nvram`. It never overrides your existing defaults.

## The toolbar

```
[ Raw ] [ Structure ]   Bytes: [16 ▼]   Endian: [Little ▼]   Format: [ … ▼ ]        [ Inspector ] [ Search ] [ Go To ]   0x00000120
```

- **Raw / Structure** — switch views. Structure is available once a format is
  applied (auto-detected or chosen).
- **Bytes** — 8, 16 or 32 bytes per row. Default from `binaryViewer.bytesPerRow`.
- **Endian** — affects the inspector and structure decoding (for formats/fields
  that don't pin their own endianness).
- **Format** — appears when at least one format is known. `(detected)` marks the
  auto-detected one. Choose **(none)** to go back to raw-only.
- **Inspector / Search / Go To** — toggles and tools (also on the command
  palette and keybindings).
- The right-hand readout shows the caret offset and `+N` selection length.

## Selecting bytes

- Click a hex **or** ASCII cell — the matching cell in the other column
  highlights too.
- Click-drag, or click then **Shift+click**, to select a range.
- Keyboard (view focused): arrows move the caret, **Shift** extends the
  selection, **Page Up/Down**, **Home/End** (row), **Ctrl/Cmd+Home/End** (file).

The status bar shows `Offset` (hex), `Decimal`, `File Size`, `Selected` length
and the `Value` under the caret.

## Data inspector

Toggle with the toolbar button or **Ctrl/Cmd+Alt+I**. Sections:

- **Selected Byte** — offset (hex + decimal), hex, binary, octal, unsigned
  (`uint8`), signed (`int8`), ASCII.
- **Interpret at caret** — `int/uint 8…64`, `float32`, `float64` in the current
  toolbar endianness, starting at the caret. Types that would run past EOF show
  `--`.
- **Selected Range** (when >1 byte) — offset, length, hex dump, plus the scalar
  interpretations from the range start in **both** Little Endian and Big Endian.

## Structure view

1. Apply a format (auto-detected, the **Format** dropdown, or **Binary Viewer:
   Select Binary Format**).
2. The table lists `Offset · Name · Type · Value`. Hover a row for its
   description / raw representation.
3. **Click** a row to select and highlight its bytes in the raw view.
   **Double-click** (or **Binary Viewer: Show Field in Raw View**) also switches
   to Raw and scrolls there.
4. `flags` / `bitfield` fields expand to a `Bit 7 … 0` header and one line per
   bit or bit-range with its value (and enum label, if any).

If parsing hits a problem (e.g. a field past EOF) the affected row shows
`<reads past end of file>` and the rest still render.

## Sections view (memory map)

The third toolbar tab (**Sections**, or **Ctrl/Cmd+Alt+M**) shows a table of
named regions:

- Columns: **Section · Start · End · Length**, plus **Flags** and **Display**
  when the format's sections define them.
- **Click** a row to select `[start, end)` in the raw view; **double-click** to
  jump to Raw.
- Rows with `"display": false` render struck-through; tick **Hide "display: No"**
  in the tab's toolbar to drop them.
- If the active format has no `sections` array, the tab derives one row per
  top-level structure field (labelled *derived*).

Add sections to a format with a `sections` array (see
[FORMAT_DEFINITIONS.md](FORMAT_DEFINITIONS.md#sections-memory-map)) or the
**Sections (memory map)** box in the format editor.

## Search

Open with the **Search** button or **Ctrl/Cmd+F**.

| Kind | Example | Notes |
| --- | --- | --- |
| Hex | `FF 00 A5 10` or `ff00a510` | `??` = wildcard byte, `F?` = wildcard nibble |
| Text | `HELLO` | tick **Aa** for case-insensitive |
| UTF-8 | `café` | |
| UTF-16 | `note` | encoded little-endian |
| Bits | `10101010` | length must be a multiple of 8, `?` allowed |

- **`>`** / Enter = find next, **`<`** / Shift+Enter = find previous,
  **All** = collect every match (capped by `binaryViewer.maxSearchResults`), then
  `>` / `<` cycle the list.
- **F3** / **Shift+F3** work without the bar focused.
- Very large files are scanned in chunks with a time budget; the status shows
  `partial scan` if it stopped early — press next again to continue.

## Go To Offset

**Ctrl/Cmd+G** or the **Go To** button. Accepts `0x1000`, `4096`, `1000h`, or a
bare hex value. Out-of-range input is rejected with a message.

## Working with formats

For a guided build, follow [CREATING_A_FORMAT.md](CREATING_A_FORMAT.md); for the
full schema see [FORMAT_DEFINITIONS.md](FORMAT_DEFINITIONS.md). Quick tour:

- **Binary Viewer: Generate Binary Format From File** scaffolds a valid starter
  JSON and opens it for hand-editing — a whole-file skeleton, or, from a byte
  selection, a repeating `array` with the element count computed for you. Ideal
  when a file holds a large table: you edit one `items` template instead of
  thousands of fields.
- **Binary Viewer: Create Binary Format** opens the form editor. Fill in the
  name, endianness, optional file extensions and magic bytes, then add fields
  (name, type, offset — leave blank to pack after the previous field — size,
  length, per-field endian, description). Composite fields (`flags`, `enum`,
  `array`, `struct`, `timestamp`) take their extra properties as a small JSON
  snippet in the row's **advanced** disclosure. A live JSON preview and
  validation panel update as you type. **Save** writes it to global storage.
- **Edit** an existing format the same way (built-ins open as an editable copy).
- **Duplicate** pre-fills the editor with `… (copy)`.
- **Import / Export** move definitions as `.json` files.
- **Reload** re-scans global + workspace definitions (also automatic via a file
  watcher).

### Where formats live

| Source | Location | Editable | Precedence |
| --- | --- | --- | --- |
| Builtin | shipped with the extension | copy-on-edit | lowest |
| Global | `<globalStorage>/binary-viewer/formats/*.json` | yes | middle |
| Workspace | `<workspace>/.vscode/binary-viewer/formats/*.json` | yes (edit the file) | highest |

A workspace format with the same `name` replaces the global/builtin one — handy
for a repo full of proprietary firmware layouts. Workspace formats load only in
**trusted** workspaces.

## Themes

The UI is drawn entirely with VS Code theme variables, so light, dark and
high-contrast themes all work with no extra configuration.
