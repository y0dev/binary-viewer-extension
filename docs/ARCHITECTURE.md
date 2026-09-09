# Architecture

## Overview

```
┌─────────────────────────── Extension host (Node) ───────────────────────────┐
│                                                                             │
│  extension.ts                                                               │
│    ├─ FormatManager ── FormatStorage ── BuiltinFormats                      │
│    │     (builtin < global < external < workspace; debounced watchers on    │
│    │      every location; precedence via core/FormatMerge)                   │
│    ├─ BinaryEditorProvider  (CustomReadonlyEditorProvider)                  │
│    │     ├─ BinaryDocument ── BinaryReader (range reads) ── BinaryCache     │
│    │     └─ per-panel message router                                       │
│    ├─ commands/*  (Go To, Search, Toggle*, Create/Edit/Import/Export,      │
│    │              Generate…, Validate/Apply format file)                   │
│    ├─ AdditionalExtensions  (reopen configured extensions as binary)       │
│    └─ FormatEditorPanel  (WebviewPanel form editor)                        │
│                                                                             │
│  core/  ── pure, no vscode/node ── DataTypes, Endianness, BitField,        │
│           FieldShape (container/bit-field/primitive classification),        │
│           FieldSyntax ("float32[8]" shorthand),                           │
│           BinaryField, BinaryParser, FormatSchema (+ validateFormatText),  │
│           FormatResolve (inline reusable `structures`),                    │
│           FormatDetector, FormatMerge (name/filename precedence,           │
│           isFormatFilePath), Sections, FormatScaffold, SearchPattern,      │
│           humanize                                                         │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │  typed postMessage protocol (types/messages.ts)
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                          Webview (browser context)                          │
│  webview/main.ts                                                            │
│    ├─ Store            (central observable state)                           │
│    ├─ DataProvider     (bounded block cache; requests ranges from host)     │
│    ├─ HexView          (VirtualGrid-backed hex/ASCII grid, selection)       │
│    ├─ StructureView    (parsed-node tree, breadcrumb, field→bytes)          │
│    ├─ SectionsView     (memory-map table; row→bytes)                        │
│    ├─ Inspector        (scalar interpretation, LE/BE)                       │
│    ├─ Toolbar          (Raw/Structure/Sections, bytes/row, endian,          │
│    │                    format select + ↻ reload, search, go-to)           │
│    ├─ SearchBar        (query kinds, next/prev/all)                         │
│    ├─ StatusBar                                                             │
│    └─ formatEditor/    (the form editor's own bundle)                       │
└────────────────────────────────────────────────────────────────────────────┘
```

## Responsibility split

| Concern | Owner |
| --- | --- |
| File access, `fs` handles, range reads | `binary/BinaryReader` (host) |
| Bounded caching of file bytes | `binary/BinaryCache` (host), `webview/DataProvider` (webview) |
| Binary parsing, format schema, scaffolding | `core/*` (pure — runs in host today, importable anywhere) |
| Reusable `structures` -> inline `fields` | `core/FormatResolve` (pure; run in `doParse` before parsing) |
| Format discovery, storage, watchers | `formats/*` (host) |
| Format precedence (name / filename merge) | `core/FormatMerge` (pure) |
| Sections / memory-map row building | `core/Sections` (pure) |
| Generate a starter format | `core/FormatScaffold` (pure) + `commands/GenerateFormat` |
| Validate / apply a hand-edited format `.json` | `commands/FormatFileActions` + `core/FormatSchema.validateFormatText` |
| Streaming search | `binary/BinarySearch` (host) + `core/SearchPattern` (pure) |
| Rendering, selection, scrolling, interaction | `webview/*` |
| Commands / palette / keybindings / menus | `commands/*` (host) |

The webview never receives more than a bounded window of file bytes. All
messages are described by the discriminated unions in
[`src/types/messages.ts`](../src/types/messages.ts).

## Folder map vs. the classic layout

The requested layout groups everything under `binary/`. This implementation
splits it by dependency surface so the parser stays unit-testable without an
extension host:

| Requested | Here |
| --- | --- |
| `binary/BinaryReader`, `binary/BinaryCache` | `src/binary/` (Node `fs`) |
| `binary/BinaryFormat`, `BinaryParser`, `BinaryField`, `DataTypes`, `Endianness`, `BitField` | `src/core/` (pure) |
| — | `src/core/` also holds `FieldShape`, `FormatSchema`, `FormatDetector`, `FormatMerge`, `Sections`, `FormatScaffold`, `SearchPattern`, `humanize` |
| `formats/FormatManager`, `FormatStorage`, `FormatDetector` | `src/formats/` (+ pure scoring in `core/FormatDetector`, pure merge in `core/FormatMerge`) |
| `editor/*`, `commands/*`, `types/*` | same (`commands/` includes `GenerateFormat`, `FormatFileActions`) |
| `webview/*`, `webview/components/*` | `src/webview/*` + `src/webview/formatEditor/*` (three esbuild bundles) |

## Performance model

- **Reads** are block-aligned (`binaryViewer.blockSizeBytes`, default 64 KiB).
  `BinaryReader` keeps one OS file handle and issues positioned reads.
- **Host cache** (`BinaryCache`) is an LRU capped at `binaryViewer.cacheWindowBytes`
  (default 8 MiB) regardless of file size.
- **Webview cache** (`DataProvider`) is a second small LRU of the same blocks so
  small scrolls and inspector reads don't round-trip to the host.
- **Rendering** (`HexView` + `VirtualGrid`) only builds DOM for visible rows plus
  an overscan margin. For files whose `rows × rowHeight` exceeds ~30 M px the
  scrollbar is *scaled*: scroll position maps proportionally to the first visible
  row instead of 1:1 pixels.
- **Search** streams the file in 1 MiB chunks with `patternLength − 1` overlap and
  a time budget, returning partial results with a `scannedTo` cursor.

## Build

`esbuild.js` produces three bundles:

| Entry | Output | Platform |
| --- | --- | --- |
| `src/extension.ts` | `dist/extension.js` | `node`, `vscode` external |
| `src/webview/main.ts` | `dist/webview.js` | `browser` IIFE |
| `src/webview/formatEditor/main.ts` | `dist/formatEditor.js` | `browser` IIFE |

Type-checking is separate: `tsconfig.json` (host, Node + vscode libs) and
`tsconfig.webview.json` (DOM lib, no Node types). Tests compile via
`tsconfig.test.json` to `out/`.

## Extensibility

The format schema is intentionally a superset of what the parser implements
today. `FieldDefinition` already carries the shape for nested structs, arrays,
enums, bit fields, timestamps, scale/bias and per-field endianness; the
top-level `sections` array drives the memory-map view. Future additions
(variable-length fields, conditionals, calculated/CRC fields, pointer chasing,
C-struct / DWARF / ELF / S-record / Intel-HEX importers) slot in as:

1. new `type` handlers in `core/BinaryParser` (+ `computeFieldSize` + schema
   validation), and
2. optional new message fields — never a code-execution hook.

### Format authoring

`core/FormatScaffold` emits *valid starter* definitions (whole-file skeleton, or
a computed `array` from a byte selection) that the user finishes by hand;
`core/FormatSchema.validateFormatText` re-validates a JSON file's raw text
(single definition or an array, JSON-syntax errors included) for the
editor-title / CodeLens **Validate** and **Apply** buttons in
`commands/FormatFileActions`. `core/FormatMerge` resolves precedence purely, by
format `name` **or** backing-file name, so `formats/FormatManager` only has to
load the three groups and merge. `core/FormatResolve` expands the top-level
`structures` map into inline `fields` (see *Nested structures* below).

### Nested structures

`core/FieldShape` is the single place that decides whether a `FieldDefinition`
is a **primitive** (`type`), a **nested structure** (`fields` without `type`, or
`type: "struct"`) or the **bit-field form** (`type` + `{ bits }` entries). The
parser threads a `stack` of `{ id, path }` frames so every emitted `ParsedNode`
carries `parentId`, `path` and `isContainer`; `computeStructSize` resolves a
structure's size (explicit or largest-child-end) and recurses. Child offsets in
a definition are always relative to their parent; the parser converts them to
absolute.

**Reusable named structures** build on this: `core/FormatResolve` inlines every
`"type": "<StructName>"` reference (from `structures`) into a typeless `fields`
container before the parser or `computeFieldSize` ever see it — so no parser or
protocol change was needed. It detects reference cycles and reports them.
