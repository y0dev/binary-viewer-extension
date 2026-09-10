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
[ Raw ] [ Structure ] [ Sections ]   Bytes: [16 ▼]   Endian: [Little ▼]   Format: [ … ▼ ] ↻   [ Inspector ] [ Search ] [ Go To ]   0x00000120
```

- **Raw / Structure / Sections** — switch views. Structure and Sections need a
  format applied (auto-detected or chosen); Sections also works from a format's
  top-level fields when it declares no `sections`.
- **Bytes** — 8, 16 or 32 bytes per row. Default from `binaryViewer.bytesPerRow`.
- **Endian** — affects the inspector and structure/sections decoding (for
  formats/fields that don't pin their own endianness).
- **Format** — appears when at least one format is known. Entries are tagged
  `[workspace]` / `[builtin]`; `(detected)` marks the auto-detected one. Choose
  **(none)** to go back to raw-only. The **↻** button rescans the workspace and
  global formats folders.
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
  with **+ Add Field / Array / Enum / Structure**. Each row has a type combo box
  (a scalar / composite / structure name, or a shorthand like `float32[8]`),
  offset (blank = pack after the previous field), size, length and per-field
  endian. **Enum** rows get a value → label table; **timestamp** fields get
  size / unit / epoch dropdowns. Only `bits` / `scale` / `bias` / `unit` /
  `display` still go in the row's **advanced** box. A live JSON preview and
  validation panel update as you type. **Save** writes it to global storage;
  **Save draft** writes it even with validation errors so a work-in-progress
  isn't lost.
- **Form ⟷ JSON tabs.** The editor has a **JSON** tab that edits the whole
  definition as text (one object, or an array of them). It opens there
  automatically for things the form can't draw — a multi-dimensional array, or
  an array of an inline structure. **Open JSON file…** (next to the tabs, in
  either mode) starts the editor from an existing definition on disk instead of
  the blank template.
- **Edit** an existing format the same way (built-ins open as an editable copy).
  If the active format was applied from a file outside a scanned folder, **Edit
  Format** offers **Locate JSON…** to pick it.
- **Duplicate** pre-fills the editor with `… (copy)`.
- **Import / Export** move definitions as `.json` files.
- **Editing the JSON by hand?** When a `.vscode/binary-viewer/formats/*.json`
  (or global) file is open, two buttons appear in the editor title bar and as
  CodeLenses at the top of the file:
  - **✓ Validate** — checks the current text (JSON syntax + the format schema)
    and reports problems in a notification and the Problems panel. Runs
    automatically on save too.
  - **↻ Apply to open binary** — saves, reloads, and applies this format to the
    open binary viewer so you see the effect immediately.
- **Reload** re-scans global + workspace definitions. It also happens
  automatically: file watchers on both locations pick up new / edited / deleted
  JSON within ~150 ms, and the **↻** button beside the format dropdown forces it.
  When the JSON of the *currently applied* format changes, the open file
  re-decodes in place.

### Where formats live

| Source | Location | Editable | Precedence |
| --- | --- | --- | --- |
| Builtin | shipped with the extension | copy-on-edit | lowest |
| Global | `<globalStorage>/…/formats/*.json` (Generate + editor save here) | yes | ↑ |
| External | every folder in `binaryViewer.formatDirectories` | yes (edit the file) | ↑ |
| Workspace | `<workspace>/.vscode/binary-viewer/formats/*.json` | yes (edit the file) | highest |

A higher source replaces a lower one when they collide **by format `name` or by
JSON file name** — so dropping `firmware.json` into
`.vscode/binary-viewer/formats/` shadows the global `firmware.json` even if the
`name` fields differ. Workspace formats load only in **trusted** workspaces.

- **`binaryViewer.formatDirectories`** — a list of extra folders (absolute; `~`
  and `${workspaceFolder}` expand). Point it at a team share or a synced folder
  so the same format library is available on another machine. Files there are
  watched like the others; the dropdown tags them `[external]`.
- **`binaryViewer.showBuiltinFormats`** — set to `false` to hide the shipped
  example formats from the dropdown and from auto-detection.

## More settings

- **`binaryViewer.defaultView`** — the tab a file opens on (`raw`, `structure`
  or `sections`). `structure` / `sections` fall back to `raw` when no format
  applies; whichever tab you last used for a given file always wins.
- **`binaryViewer.baseAddress`** — an address (e.g. `0x08000000`, decimal, or
  `…h`) that the offset / address columns, the status bar and **Go To** are shown
  relative to, so they match a memory-mapped datasheet or linker map. A format
  can carry its own `baseAddress`, which wins. Field offsets in a definition are
  still written from `0`. With a base set, **Go To** accepts either a file offset
  or a full address.
- **`binaryViewer.structure.maxArrayElements`** (default `1000`) — how many
  elements a single `array` field renders in the Structure view before the rest
  collapse into one "… N more" row. This setting is authoritative — raise it and
  you get that many, even for a large nested array. `0` removes the limit (the
  parser still stops at ~1 000 000 total nodes as a safety backstop). Bigger
  values load and render more, so expect a slower Structure tab.
- **`binaryViewer.additionalExtensions`** — extra file extensions (`s19`,
  `.mot`, …) to open in the Binary Viewer automatically, on top of the built-in
  list. A file you deliberately reopen as text stays text for the session.
- **`binaryViewer.timestamp.defaultEpoch`** / **`binaryViewer.timestamp.displayUTC`**
  — the epoch (`unix` / `y2k` / `gps` / `mac` / `filetime`) assumed for
  `timestamp` fields that don't set their own, and whether decoded times show in
  UTC or the host's local time zone.

## Themes

The UI is drawn entirely with VS Code theme variables, so light, dark and
high-contrast themes all work with no extra configuration.
