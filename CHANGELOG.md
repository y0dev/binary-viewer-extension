# Change Log

## 0.18.0

- **Refresh button in the format editor.** A new **↻ Refresh** button next to
  **Change file…** in the **File:** row reloads the definition from its
  backing file (or resets to the last loaded state for a not-yet-saved
  format), discarding unsaved edits in the editor — with a confirmation
  prompt first. Handy after editing the JSON outside the editor, or to back
  out changes you don't want.

## 0.17.0

- **Readable type labels for nested arrays.** In the Structure view, every
  level of a nested array now shows the full remaining shorthand-chain type
  (e.g. `int16[4][3][2]` for the outer level of a 3D array, `int16[4][3]` for
  a "plane", `int16[4]` for a "row") instead of the uninformative `array[N]`
  it showed before. A level sized by `countField` shows `?` in place of the
  count it can't know statically (e.g. `uint8[? ← rows][2]`). No change to
  parsing, offsets, or the tree shape itself — display only.

## 0.16.0

- **`countField` sums multiple terms, including decoded fields directly.**
  `countField` is now a `"+"`-separated sum (a single name is a one-term sum,
  so every existing format keeps working) — each term is a literal integer, a
  `constants` entry, or an earlier decoded field, checked in that order. So a
  header that stores, say, a dog count and a cat count as separate fields can
  size an array from their total with `"countField": "Number of Dogs +
  Number of Cats"` — no `constants` involved, since `constants` are fixed at
  authoring time and never see decoded bytes. A resolution failure now names
  the specific term that didn't match.

## 0.15.1

- **Fix: multi-word constant names in a "+" sum.** A `constants` entry like
  `"Num of Animals": "Number of Dogs + Number of Cats"` failed to resolve —
  each term was checked against an identifier pattern that rejected spaces.
  A term is now matched against the other defined constant names directly, so
  any name works as long as it doesn't contain a literal `+`.

## 0.15.0

- **Named constants for array size.** A top-level `constants` map defines
  values a field can reference by name — a plain number, or a `"+"`-separated
  sum of other constants/numbers (e.g. `"Total": "Mean + Range"`). An array's
  `countField` is checked against `constants` first, then falls back to the
  existing "earlier decoded field" behavior, so existing formats are
  unaffected. The form editor gets a **Constants** section (`+ Add Constant`)
  above *Reusable structures*. Pure `core/FormatConstants.ts`.
- **Nested arrays editable in the form, up to 3 dimensions.** The form
  editor's array row now accepts a chained element type (`"int16[4][3]"`) and
  no longer forces the "use JSON" warning for it — a fixed-size nested array
  round-trips as shorthand text in the same element-type box, up to
  `MAX_FORM_ARRAY_DEPTH` (3) dimensions total. Deeper nesting, a `countField`/
  `view`/`description` at an inner level, or an array of an inline structure
  still requires the JSON tab. Also fixes `FieldSyntax.expandShorthandDeep`
  to fully expand a chained shorthand array (previously only one level into
  `items`), so `FormatSchema.validateFormat` no longer misreports a 3+-level
  chain as an unknown type.

## 0.14.0

- **Consistent key order in generated format JSON.** The form editor's Save /
  Save draft / JSON Preview now always emit `name` first and `fields` last,
  with `endianness`, `description`, `version`, `author`, `fileExtensions`,
  `magic`, `baseAddress`, `structures` and `sections` (whichever are present)
  in between — instead of whatever order the form happened to build them in.
  Only governs what the *form* generates; hand-written JSON in the editor's
  JSON tab is never reordered. Pure `core/FormatOrder.ts`.

## 0.13.0

- **Array views — render just a slice of a big array.** An `array` field can
  set `"view": "20...35"` (or `{ "start": 20, "end": 35 }`, both inclusive,
  either order) so the Structure view renders only that window of elements
  instead of always starting at 0. Elements outside the view are summarised as
  "… N elements before/after this view not shown"; the array's own count,
  size and offsets are completely unaffected, and it composes with
  `binaryViewer.structure.maxArrayElements`, which still caps how many
  elements are shown at once. The form editor's array rows get a matching
  **view** box. Warns (doesn't fail validation) when set on an array of 50 or
  fewer elements, where it has no visible effect. Pure `core/ArrayView.ts`.

## 0.12.0

- **Format editor tracks its backing file.** A "File: …" row (both Form and
  JSON tabs) shows the JSON file a format is tied to — a workspace, external,
  or global one, or "not saved to a file yet" for a brand-new format. **Save**
  now writes there directly instead of always creating a global-storage copy;
  **Change file…** opens a Save-As dialog to redirect future saves elsewhere.
  Editing an existing format (by name, or via **Open JSON file…** / **Locate
  JSON…**) now correctly ties to its real file. **Save draft** always writes a
  separate global-storage copy — it never overwrites a known real file with
  content that doesn't validate yet.
- **Fix — picking "array" or "struct" as a field's type did nothing.** The
  type box let you type/select `array` or `struct`, but a plain field row has
  no count/element-type or child-field controls, so the result was a silently
  incomplete definition. Committing (blur, or a datalist pick) either value
  now switches that row to the matching kind and reveals what it needs — count
  + element type for an array, a first child field for a struct — without
  interrupting typing along the way.

## 0.11.0

- **Field Colors — highlight each field's bytes in the raw hex view.** A new
  toolbar toggle tints every byte by the top-level field it belongs to (a
  nested struct/array is one color for its whole span), so field boundaries
  are visible without switching to Structure. Off by default and disabled
  until a format is applied to the file — there's nothing to color by
  otherwise — and it turns itself back off if the format is cleared. Byte
  selection and the caret outline stay fully visible over the tint, so the raw
  view is still just as usable for plain selection. Pure
  `core/FieldColors.ts` (Okabe–Ito colorblind-safe palette, cycled by
  top-level field order; binary-search byte→color lookup).
- **New [`docs/HOW_TO.md`](docs/HOW_TO.md)** — a task-oriented quick reference
  ("how do I…") linking out to the deeper guides, with a troubleshooting
  section.

## 0.10.0

- **Word view in the raw hex dump.** A new **Group** control in the Raw toolbar
  shows bytes as 16- / 32- / 64-bit words. `·LE` reverses the bytes so a
  little-endian `01 00 00 00` reads as `00000001`; `·BE` keeps file order.
  Clicking a word selects it, arrow keys step word-by-word, the ASCII column and
  everything downstream (Structure, inspector, Go To) still work on the real
  bytes. Raw view only — it does not touch the structure decoder or the
  inspector. Remembered per file; default from `binaryViewer.byteGroup`.

## 0.9.6

- **Form editor is practical for fields / arrays / enums now** — less need for the
  JSON tab:
  - **Enum editor** — a value → label table right on the field (**+ Add Enum**, or
    it appears for any `enum` field / integer scalar), instead of hand-writing
    `{ "enum": { … } }` in the advanced box.
  - **Timestamp editor** — size / unit / epoch dropdowns instead of JSON.
  - **Type is now a combo box** everywhere (fields and array elements): pick a
    scalar / composite / structure name, or type a shorthand like `float32[8]`
    or `int16[4]` for a nested array.
  - The advanced box is now just bits / scale / bias / unit / display.
- **Save draft** — a second save button that writes the definition to global
  storage even when validation fails, so a work-in-progress doesn't force you
  into raw JSON. It's flagged as a draft and lists the problems to fix.

## 0.9.5

- **"Open JSON file…" is now always in reach.** It sits next to the Form / JSON
  tabs in both modes, so when you run **Create Binary Format** and land in the
  blank editor you can load an existing definition from disk instead of building
  from scratch — handy when nothing was generated for the file.

## 0.9.4

- **Format editor: Form ⟷ JSON toggle.** The editor now has a "JSON" tab that
  edits the whole definition as text (single object or an array), live-validated,
  Save/Validate work from either tab. It opens on the JSON tab automatically when
  the definition has something the form can't fully show — a multi-dimensional
  array, or an array whose element is an inline structure — with a warning if you
  switch such a format to the form tab.
- **Fix — "Edit Format" did nothing for some formats.** A format applied from a
  JSON file outside any scanned folder isn't registered by name, so the button
  silently returned. It now offers **Locate JSON…** to pick the file, and the
  JSON tab has an **Open JSON file…** button for the same.

## 0.9.3

- **`binaryViewer.structure.maxArrayElements` is now the real limit.** A separate
  internal node budget (20 000) could stop a large / deeply-nested array well
  before the configured per-array cap was reached — so raising the setting did
  nothing past that point. The budget now scales with the setting
  (`maxArrayElements × 50`, floor 100 000, hard ceiling 1 000 000 as a backstop
  against `[cap][cap][cap]`-style blow-ups) and `0` (no cap) parses up to the
  ceiling. Every element up to the setting is loaded and shown; a "… N more"
  row only appears when the cap itself — or, rarely, the ceiling — is hit.
- **Fix — `countField` arrays past the first 4 KB showed "outside loaded
  window".** The decode window was sized from `computeFieldSize`, which reports
  `0` for a `countField` array (its length isn't known until parse time), so
  only the 4 KB header was read. A format with any parse-time-sized field now
  reads up to the whole file (bounded at 8 MB) so those elements decode.

## 0.9.2

- **Fix — large multi-dimensional arrays (follow-up to 0.9.1).** When a nested
  array was big enough to exhaust the structure node budget *mid-parse*, the
  outer elements were still mis-sized: the running-cursor size was trusted even
  though the element loop had stopped early. The cursor size is now used only
  when every element was parsed; otherwise the exact static size wins. A
  truncated array always emits a "… N more not shown" row that names the limit
  that stopped it (element cap vs node budget). Verified on `int16[2][4][40000]`.

## 0.9.1

- **Fix — nested (multi-dimensional) array offsets.** An `array` whose elements
  are themselves arrays advanced the parent offset by a *static* element size,
  which is `0` when the inner array is sized by `countField` (or is missing
  `count`) — so every outer element landed at the same offset. Elements are now
  placed by what each one actually consumes. A `struct` element likewise grows
  to fit a `countField` child that reads longer than its static size.

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
