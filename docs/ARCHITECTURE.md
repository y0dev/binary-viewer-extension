# Architecture

## Overview

```
┌─────────────────────────── Extension host (Node) ───────────────────────────┐
│                                                                             │
│  extension.ts                                                               │
│    ├─ FormatManager ── FormatStorage ── BuiltinFormats                      │
│    │     (builtin + global + workspace, precedence resolution, watchers)    │
│    ├─ BinaryEditorProvider  (CustomReadonlyEditorProvider)                  │
│    │     ├─ BinaryDocument ── BinaryReader (range reads) ── BinaryCache     │
│    │     └─ per-panel message router                                       │
│    ├─ commands/*  (Go To, Search, Toggle*, Create/Edit/Import/Export…)     │
│    └─ FormatEditorPanel  (WebviewPanel form editor)                        │
│                                                                             │
│  core/  ── pure, no vscode/node ── DataTypes, Endianness, BitField,        │
│            BinaryField, BinaryParser, FormatSchema, FormatDetector,        │
│            SearchPattern, humanize                                          │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │  typed postMessage protocol (types/messages.ts)
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                          Webview (browser context)                          │
│  webview/main.ts                                                            │
│    ├─ Store            (central observable state)                           │
│    ├─ DataProvider     (bounded block cache; requests ranges from host)     │
│    ├─ HexView          (VirtualGrid-backed hex/ASCII grid, selection)       │
│    ├─ StructureView    (parsed-node table, field→bytes highlight)           │
│    ├─ Inspector        (scalar interpretation, LE/BE)                       │
│    ├─ Toolbar          (view toggle, bytes/row, endian, format, search)     │
│    ├─ SearchBar        (query kinds, next/prev/all)                         │
│    └─ StatusBar                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

## Responsibility split

| Concern | Owner |
| --- | --- |
| File access, `fs` handles, range reads | `binary/BinaryReader` (host) |
| Bounded caching of file bytes | `binary/BinaryCache` (host), `webview/DataProvider` (webview) |
| Binary parsing & format schema | `core/*` (pure — runs in host today, importable anywhere) |
| Format discovery, storage, precedence | `formats/*` (host) |
| Streaming search | `binary/BinarySearch` (host) + `core/SearchPattern` (pure) |
| Rendering, selection, scrolling, interaction | `webview/*` |
| Commands / palette / keybindings | `commands/*` (host) |

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
| `formats/FormatManager`, `FormatStorage`, `FormatDetector` | `src/formats/` (+ pure scoring in `core/FormatDetector`) |
| `editor/*`, `commands/*`, `types/*` | same |
| `webview/*`, `webview/components/*` | `src/webview/*` (bundled separately by esbuild) |

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
enums, bit fields, timestamps, scale/bias and per-field endianness. Future
additions (variable-length fields, conditionals, calculated/CRC fields, pointer
chasing, C-struct / DWARF / ELF / S-record / Intel-HEX importers,
memory-map visualization) slot in as:

1. new `type` handlers in `core/BinaryParser` (+ `computeFieldSize` + schema
   validation), and
2. optional new message fields — never a code-execution hook.
