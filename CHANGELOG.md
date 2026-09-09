# Change Log

## 0.9.0 — Display & decoding settings, length-prefixed arrays

- **Length-prefixed arrays** — an `array` field can set `"countField": "<name>"`
  instead of a fixed `count` to take its element count from an earlier integer
  field's decoded value. A packed field after it lands at the right offset; the
  Structure view's element cap still guards against a corrupt prefix. In the
  form editor, type a field name (not a number) into an array row's **count**
  box. Pure `core/BinaryParser`.
- **`binaryViewer.baseAddress`** — show the offset / address columns, status bar
  and **Go To** relative to a base address (e.g. `0x08000000` for mapped flash)
  so they match a datasheet or linker map. A format may set its own
  `baseAddress`, which wins. With a base in effect, **Go To** accepts a file
  offset *or* a full address.
- **`binaryViewer.structure.maxArrayElements`** (default `1000`) — cap on
  elements rendered per `array` field in the Structure view; the rest collapse
  into one "… N more" row. Stops a huge `float32[200000]` locking up the tree.
  `0` = no limit.
- **`binaryViewer.defaultView`** — which tab a file opens on (`raw` /
  `structure` / `sections`); falls back to `raw` with no format, and the
  last-used tab for a file still wins.
- **`binaryViewer.additionalExtensions`** — extra file extensions (`s19`,
  `.mot`, …) opened in the Binary Viewer automatically; reopening one as text
  is respected for the session.
- **`binaryViewer.timestamp.defaultEpoch`** (`unix` / `y2k` / `gps` / `mac` /
  `filetime`) and **`binaryViewer.timestamp.displayUTC`** — epoch fallback for
  `timestamp` fields with no `epoch`, and UTC vs local rendering. New `gps`,
  `mac` and `filetime` epochs are also usable per field.

## 0.8.0

- Version skipped — the same changes shipped as 0.9.0.

## 0.7.0 — Array shorthand & external format folders

### Array shorthand

- Any field `type` may be written as `<base>[<n>]` — `"float32[8]"`,
  `"int16[24]"`, `"Sample[100]"` (array of a reusable structure), `"char[4]"`
  (a 4-char string), `"bytes[12]"`. Expanded before validation / sizing /
  parsing (pure `core/FieldSyntax.ts`). The form editor round-trips it to a
  proper array row.

### Format sources & settings

- **`binaryViewer.formatDirectories`** — a list of extra folders to load format
  `*.json` from (a shared / network drive, a synced folder for another machine).
  `~` and `${workspaceFolder}` expand; the folders are watched; entries show as
  `[external]`. Precedence: builtin < global < external < workspace.
- **`binaryViewer.showBuiltinFormats`** (default `true`) — set `false` to hide
  the shipped example formats from the dropdown and auto-detection.
- Both settings reload formats live on change. Validate / Apply buttons now also
  recognise a format `.json` opened from an external folder.

## 0.6.0

- Version skipped — the same changes shipped as 0.7.0.

## 0.5.0 — Format authoring workflow

### Generate a format from a binary

- New command **Binary Viewer: Generate Binary Format From File** (also on the
  Structure / Sections empty-state buttons). Scaffolds a *valid* starter JSON,
  saves it to global storage, applies it, and opens it for hand-editing:
  - **Whole-file skeleton** — `magic` from the first bytes + `header` / `body`
    placeholders.
  - **From the current selection** — an `array` whose element count is computed
    from the selection: pick a scalar type, or give a record size for opaque
    `bytes` / a `struct` stub. The point is large repeating data — you edit one
    `items` template instead of thousands of fields; leftover bytes are reported.
- Pure `core/FormatScaffold.ts`.

### Refresh & precedence

- **Global storage is now watched** too (not just the workspace), so a format
  JSON dropped into `<globalStorage>/binary-viewer/formats/` is picked up
  without a manual reload. File events are debounced (~150 ms).
- Precedence is now **format name OR JSON file name**: a workspace
  `firmware.json` shadows a global `firmware.json` even when the two `name`
  fields differ (previously only the `name` field decided it). Pure
  `core/FormatMerge.ts`.
- When the *applied* format's JSON changes, the open file **re-decodes in
  place**; if that format's file is deleted, the viewer falls back to Raw.
- A **↻ Reload formats** button sits next to the format dropdown; the dropdown
  now tags entries `[workspace]` / `[builtin]`.

### Editing format JSON by hand

- When a format `.json` file is open (in `.vscode/binary-viewer/formats/` **or**
  the global storage folder) editor-title buttons **✓ Validate** and **↻ Apply
  to open binary** appear (also as CodeLenses at the top of the file). Validate
  checks JSON syntax + the schema, reports problems in a notification and the
  Problems panel, and re-runs on save. Apply saves, reloads and re-decodes the
  open binary.
- Commands: *Binary Viewer: Validate Binary Format File* / *Apply Binary Format
  File*. Pure `validateFormatText()`.

### Reusable structures & easier arrays

- Format definitions gain an optional top-level `structures` map. A field or an
  array's `items` can set `"type": "<StructName>"` instead of repeating a
  `fields` block — the main fix for large arrays of records. Cross-references
  and cycles are detected; the whole thing is resolved to inline `fields`
  before parsing (pure `core/FormatResolve.ts`).
- **Format editor**: a "Reusable structures" section (`+ Add Structure
  Definition`); those names appear in every type dropdown. Arrays are now
  first-class (`+ Add Array` → count → element type) instead of an advanced-box
  JSON fragment. New per-row **⧉ Duplicate** button (copies the row and its
  whole subtree).
- `Generate … From File` with a struct element now emits a `structures.Record`
  + a reference to it.

## 0.4.0

- Version skipped — the same changes shipped as 0.5.0.

## 0.3.0 — Sections / memory-map view

- New **Sections** tab (`Ctrl/Cmd+Alt+M`, command *Binary Viewer: Toggle
  Sections View*): a table of `Section · Start · End · Length`, with optional
  user-defined **Flags** (`rwx`) and **Display** (`Yes`/`No`) columns.
- Format definitions gain an optional top-level `sections` array
  (`{ name, start, length | end, flags?, display? }`; `start`/`length` accept
  `0x` hex / `…h` / decimal strings). `fields` is now optional when `sections`
  is present, so a definition can be a pure memory map.
- The tab falls back to deriving one row per top-level structure field when a
  format has no `sections`. Rows are sorted by address; clicking one selects
  `[start, end)` in the raw view; `display: false` rows are struck-through and
  hidable.
- Format editor: a **Sections (memory map)** JSON box with an "insert example
  section" helper.
- New example `flash-layout.json` (sections-only 128 KiB MCU flash map) +
  `flash.fls`; `nested-firmware.json` gains a `sections` array.

## 0.2.0 — Nested structures

- Binary format definitions now support **nested structures**: a field with a
  `fields` array and no `type` is a container. Child offsets are **relative to
  the enclosing structure**; the parser resolves absolute offsets. Nesting is
  unlimited and can be freely mixed with flat fields. `type: "struct"` still
  works. Fully backward compatible with existing flat definitions.
- Structure view renders the hierarchy as an expandable tree (session-remembered
  collapse state) with a `Format › Header › ImageInfo › Field` breadcrumb.
  Selecting a container highlights its whole byte range in the raw view.
- Structure `size` is optional — computed from the largest child end offset when
  omitted; nested structures feed the parent calculation.
- The format editor is now a **tree editor**: `+ Add Field` / `+ Add Structure`
  at every level, move into / out of structures, reorder, collapse.
- New validation errors: field with both `type` and `fields`, field with
  neither, negative structure/child offset, overlapping fields, field extending
  beyond a declared structure size, empty structure.
- New builtin/example format `Nested Firmware (example)` + `examples/binaries/nested.fw`.
- More example format definitions with matching binaries: `wav-header.json`
  (nested RIFF sub-chunks), `mbr.json` (an array of nested partition structs,
  magic at offset 510). New step-by-step guide `docs/CREATING_A_FORMAT.md`.
- Marketplace-ready: extension id `devdoesit.binary-structure-inspector`, logo,
  screenshot-led README, `CONTRIBUTING.md` for build instructions.
- Cross-platform install: `@vscode/vsce` (and its optional native `keytar`
  dependency) removed from `devDependencies` — packaging now runs it via `npx`,
  so `npm install` needs no build toolchain on WSL/Linux. Added `.gitattributes`
  (LF for text, `binary` for fixtures/assets), `.nvmrc`, and `engines.node`.

## 0.1.0 — Initial release

### Raw view
- Custom read-only editor (`binaryViewer.hexEditor`) built on the VS Code Custom
  Editor API.
- Virtualized hex/ASCII grid with 8/16/32 bytes per row and a scaled scrollbar
  for files beyond the browser element-height limit.
- Byte + range selection with hex/ASCII synchronization and full keyboard
  navigation.
- Range-based reads through a bounded LRU cache in the extension host; the file
  is never fully loaded into the webview.
- Status bar with offset (hex/decimal), file size, selection length and caret
  value.

### Data inspector
- Per-byte and per-range interpretation as every standard integer/float type in
  little- and big-endian.

### Structure view
- Declarative binary-format engine: scalars, `bytes`/`binary`, strings
  (`ascii`/`utf8`/`utf16`), `enum`, `flags`/`bitfield`, `array`, `struct`,
  `timestamp`, per-field endianness, scale/bias/unit, display hints.
- Structure table with field → raw-bytes highlighting and a bit-field grid.
- Format detection by extension and magic bytes (with optional mask); multi-match
  picker; live format switching.

### Format authoring & storage
- Form-based Binary Format Editor (create / edit / duplicate / delete).
- Global storage under the extension's global-storage folder; workspace formats
  under `.vscode/binary-viewer/formats/*.json` override globals.
- Import / Export / Reload commands.

### Search
- Streaming binary search: hex (with `??` wildcards), ASCII (optional
  case-insensitive), UTF-8, UTF-16, bit patterns. Find next / previous / all.

### Other
- Go To Offset (`0x…`, decimal, `…h`).
- Full light / dark / high-contrast theming via VS Code theme variables.
- Unit tests for parsing, bit fields, format detection, search and large-file
  range reads (1 MB / 10 MB / 100 MB / 1 GB sparse).
