# How To — Binary Viewer & Structure Inspector

A task-oriented quick reference. For the full command/settings list see the
[User Guide](USER_GUIDE.md); for building a format from scratch see
[Creating a binary format](CREATING_A_FORMAT.md); for the JSON schema see
[Format definitions](FORMAT_DEFINITIONS.md).

## Open a file

Right-click any file in the Explorer → **Open With…** → **Binary Viewer** (or
run **Binary Viewer: Open With Binary Viewer**). It opens in **Raw** mode
immediately — no format required. The extension registers itself as an
*optional* editor for `.bin .hex .img .dat .fw .rom .dump .raw .eeprom .nvram`
and a few more via `binaryViewer.additionalExtensions` (below); it never
replaces your default editor for a file type.

## Look at raw bytes

The **Raw** tab is a virtualized hex/ASCII grid.

- **Select** — click a hex or ASCII cell (they highlight together); drag, or
  click then Shift-click, for a range.
- **Navigate** — arrow keys move the caret, Page Up/Down, Home/End,
  Ctrl/Cmd+Home/End (start/end of file). **Go To** (`Ctrl/Cmd+G`) jumps to
  `0x1000`, `4096`, or `1000h`.
- **Bytes per row** — toolbar **Bytes** (8/16/32).
- **Read a multi-byte value the way your software sees it** — toolbar
  **Group**. `1 byte` is the default hex dump; `16-bit`/`32-bit`/`64-bit`
  group the hex into words. `·LE` reverses each word's bytes, so a
  little-endian `01 00 00 00` on disk reads as `00000001`; `·BE` keeps file
  order. Clicking a word selects the whole word; arrow keys step word-by-word.
  This is a **raw-view display option only** — it doesn't touch how the
  Structure tab or the inspector decode fields; use the **Endian** toggle for
  that.
- **Inspect a value at the caret** — toggle the **Inspector**
  (`Ctrl/Cmd+Alt+I`): hex/binary/octal/signed/unsigned/ASCII for the byte, and
  `int8…int64`/`float32`/`float64` at the caret in both endiannesses.

## See the file as named fields (Structure tab)

1. Pick a format from the **Format** dropdown (auto-detected formats are
   marked `(detected)`), or run **Binary Viewer: Select Binary Format**.
2. Switch to **Structure** (`Ctrl/Cmd+Alt+S`). Click a row to select its
   bytes in Raw; double-click to jump there. Bit-field rows expand to a
   `Bit 7…0` grid.
3. No format for this file yet? See **Build your own format**, below, or use
   **Generate Binary Format From File** for a quick starting point.

## See it as a memory map (Sections tab)

`Ctrl/Cmd+Alt+M`. Shows named regions (`Section · Start · End · Length`, plus
`Flags`/`Display` if the format defines them). Works from a format's
`sections` array, or falls back to one row per top-level structure field.
Click a row to select `[start, end)`; tick **Hide "display: No"** to declutter.

## Search for a pattern

`Ctrl/Cmd+F`. Kinds: hex (`FF 00 A5 10`, `??`/`F?` wildcards), text (`Aa` for
case-insensitive), UTF-8, UTF-16, bit patterns (`10101010`, `?` allowed).
`Enter`/`>` finds next, `Shift+Enter`/`<` finds previous, **All** collects
every match up to `binaryViewer.maxSearchResults`. `F3`/`Shift+F3` work
without the search bar focused.

## Highlight each field's bytes directly in the hex view

Toolbar → **Field Colors** (Raw tab). It tints every byte by the top-level
field it belongs to — a nested struct or array is one color for its whole
span — so field boundaries are visible at a glance without switching to
Structure. It's **off by default and requires a format applied to the file**
(there's nothing to color by otherwise): the button is disabled with a tooltip
until you pick one from the **Format** dropdown, and it turns itself back off
if you clear the format. Selecting bytes and the caret outline both still show
clearly on top of the tint — the raw view stays fully usable for plain byte
selection whether or not the toggle is on.

## Build your own format

Fastest start: **Binary Viewer: Generate Binary Format From File** (also on
the Structure/Sections empty-state buttons) — scaffolds a valid starter JSON
(a whole-file skeleton, or a computed `array` from a selection) and opens it
to finish by hand.

From scratch: **Binary Viewer: Create Binary Format** opens the form editor —
name, endianness, magic bytes, then **+ Add Field / Array / Enum / Structure**.
Type boxes accept a scalar, a structure name, or a shorthand
(`float32[8]`, `int16[4]` for nested arrays, `Sample[100]`). Enum fields get a
value → label table; timestamp fields get size/unit/epoch dropdowns — no JSON
needed for either. **Save** writes it to global storage; **Save draft** saves
even with validation errors so you don't lose work.

**Prefer JSON?** The editor's **JSON** tab edits the whole definition as text
— it opens there automatically for anything the form can't fully draw (a
multi-dimensional array, or an array of an inline structure). **Open JSON
file…**, next to the tabs in either mode, starts the editor from an existing
definition on disk instead of the blank template.

Walkthrough of a real format end-to-end: [Creating a binary
format](CREATING_A_FORMAT.md). Full field/type reference:
[Format definitions](FORMAT_DEFINITIONS.md) (arrays incl. length-prefixed
`countField`, reusable `structures`, `sections`, `baseAddress`, timestamp
epochs, bit-fields, enums).

## Edit a format's JSON by hand, outside the form editor

Open the format's `.json` (in `.vscode/binary-viewer/formats/`, the global
storage folder, or a folder in `binaryViewer.formatDirectories`) and two
buttons appear in the editor title bar / as CodeLenses: **✓ Validate** (JSON
syntax + schema, reports to the Problems panel, reruns on save) and **↻ Apply
to open binary** (saves, reloads, re-decodes the open file with it).

## Share formats — with your team, or another machine

| Where | Scope | Precedence |
| --- | --- | --- |
| `.vscode/binary-viewer/formats/*.json` | this workspace, committed to the repo | highest |
| a folder in `binaryViewer.formatDirectories` | a shared/network drive or synced folder | ↑ |
| global storage | this machine | ↑ |
| built-in examples | ships with the extension | lowest |

A higher source overrides a lower one that collides by format **name or JSON
file name**. Set `binaryViewer.showBuiltinFormats: false` to drop the shipped
examples from the dropdown and detection entirely.

## Useful settings

| Setting | What it does |
| --- | --- |
| `binaryViewer.defaultView` | Tab a file opens on (raw / structure / sections) |
| `binaryViewer.baseAddress` | Show addresses relative to a base (e.g. `0x08000000` mapped flash) |
| `binaryViewer.structure.maxArrayElements` | How many elements of a big array the Structure tab renders |
| `binaryViewer.additionalExtensions` | Extra file extensions opened in Binary Viewer automatically |
| `binaryViewer.timestamp.defaultEpoch` / `.displayUTC` | Default epoch and UTC-vs-local for `timestamp` fields |
| `binaryViewer.byteGroup` | Default raw-view word grouping (see **Group**, above) |

Full list: [User Guide → settings](USER_GUIDE.md#more-settings) and the
Settings UI (search `Binary Viewer`).

## Troubleshooting

- **A Structure row shows `<reads past end of file>`** — the field's
  `offset` + size goes beyond the file; check it against the hex view.
- **A Structure row shows `outside loaded window`** — for most files this
  means an offset/size mistake in the format. For a `countField`
  (length-prefixed) array, the decode window auto-widens to the whole file
  (capped at 8 MB); a file bigger than that with dynamic content past 8 MB
  will still show this for the tail.
- **An array is truncated with "… N more not shown"** — raise
  `binaryViewer.structure.maxArrayElements` (`0` = no limit); it's the
  authoritative cap, so raising it always shows more.
- **"Edit Format" does nothing** — the active format was applied from a JSON
  file outside any scanned folder, so it isn't registered by name. Use
  **Locate JSON…** in the prompt that follows, or the JSON tab's **Open JSON
  file…**.
- **Format dropdown doesn't show your new/edited file** — press the **↻**
  button beside it (forces a rescan); edits are also picked up automatically
  within ~150 ms via file watchers.
