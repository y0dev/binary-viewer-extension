/**
 * Typed message protocol between the extension host and the webview.
 *
 * The webview owns rendering, selection, scrolling and interaction. The host
 * owns file access, caching, parsing and format management. Neither side ever
 * ships more than a bounded window of file bytes across this boundary.
 */

import type { Endianness, FormatDefinition } from './format';

export interface ViewerConfig {
  bytesPerRow: 8 | 16 | 32;
  defaultEndianness: Endianness;
  showInspector: boolean;
  blockSizeBytes: number;
  maxSearchResults: number;
  /** Tab to open on when the file has no remembered view. */
  defaultView: ViewMode;
  /** Address shown for file offset 0 (from `binaryViewer.baseAddress`). */
  baseAddress: number;
}

export interface FormatSummary {
  name: string;
  description?: string;
  source: 'builtin' | 'global' | 'external' | 'workspace';
  fileExtensions?: string[];
}

/** A flattened, render-ready parsed field. Offsets are absolute file offsets. */
export interface ParsedNode {
  id: string;
  name: string;
  typeLabel: string;
  offset: number;
  size: number;
  /** Primary display string for the Value column. */
  value: string;
  /** Optional secondary representations shown on expand / hover. */
  detail?: string;
  /** Nesting depth for tree rendering (top-level fields are depth 0). */
  depth: number;
  /** True for nested structures / arrays — rendered with a disclosure arrow. */
  isContainer?: boolean;
  /** id of the enclosing container node, or null at the top level. */
  parentId?: string | null;
  /** Name path from the top-level field down to and including this node. */
  path?: string[];
  /** Bit rows for flags/bitfield nodes. */
  bits?: ParsedBit[];
  /**
   * Decoded integer value, set for plain integer scalars and `enum` fields so a
   * later `array` can use this field as its `countField` (length prefix).
   */
  numericValue?: number;
  error?: string;
}

export interface ParsedBit {
  name: string;
  bitLabel: string; // "7-5", "0"
  value: string;
  description?: string;
}

/** One row of the Sections / memory-map view. */
export interface ParsedSection {
  name: string;
  /** Start address / file offset. */
  start: number;
  /** Size in bytes. */
  length: number;
  /** start + length (exclusive). */
  end: number;
  /** Permission string (`rwx`, `r-x`, …), only when the definition supplied one. */
  flags?: string;
  /** Explicit "display" hint from the definition, if any. `undefined` == not set. */
  display?: boolean;
  /** True when `start` is inside the file (so it can be selected in the raw view). */
  inFile: boolean;
  /** 'defined' == from the format's `sections`; 'derived' == from top-level fields. */
  source: 'defined' | 'derived';
  description?: string;
  error?: string;
}

export type ViewMode = 'raw' | 'structure' | 'sections';

export interface SearchQuery {
  kind: 'hex' | 'ascii' | 'utf8' | 'utf16' | 'bits';
  text: string;
  caseInsensitive?: boolean;
  /** Byte offset to start searching from. */
  from: number;
  direction: 'next' | 'previous' | 'all';
}

export interface SearchMatch {
  offset: number;
  length: number;
}

// ---------------------------------------------------------------------------
// Host -> Webview
// ---------------------------------------------------------------------------

export type HostToWebview =
  | {
      type: 'init';
      fileSize: number;
      fileName: string;
      uriPath: string;
      config: ViewerConfig;
      formats: FormatSummary[];
      detectedFormat: string | null;
      activeFormat: string | null;
    }
  | {
      type: 'range';
      requestId: number;
      offset: number;
      /** base64-encoded bytes for [offset, offset+length). */
      data: string;
      length: number;
    }
  | {
      type: 'parseResult';
      formatName: string;
      nodes: ParsedNode[];
      sections: ParsedSection[];
      /** The active format's own `baseAddress`, resolved to a number; null if it sets none. */
      baseAddress: number | null;
      error?: string;
    }
  | { type: 'formats'; formats: FormatSummary[]; activeFormat: string | null }
  | { type: 'searchResult'; query: SearchQuery; matches: SearchMatch[]; done: boolean; scannedTo: number }
  | { type: 'gotoOffset'; offset: number; select?: number }
  | { type: 'selectRange'; offset: number; length: number; reveal?: boolean }
  | { type: 'setView'; view: ViewMode }
  | { type: 'toggleView'; target?: 'structure' | 'sections' }
  | { type: 'toggleInspector' }
  | { type: 'showFieldInRaw' }
  | { type: 'setBytesPerRow'; bytesPerRow: 8 | 16 | 32 }
  | { type: 'setEndianness'; endianness: Endianness }
  | { type: 'focusSearch' }
  | { type: 'searchNav'; direction: 'next' | 'previous' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Webview -> Host
// ---------------------------------------------------------------------------

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'requestRange'; requestId: number; offset: number; length: number }
  | { type: 'requestParse'; formatName: string; endianness?: Endianness }
  | { type: 'setActiveFormat'; formatName: string | null; endianness?: Endianness }
  | { type: 'search'; query: SearchQuery }
  | { type: 'persistState'; state: WebviewPersistedState }
  | { type: 'openFormatEditor'; formatName?: string }
  | { type: 'generateFormat' }
  | { type: 'reloadFormats' }
  | { type: 'selectionChanged'; offset: number; length: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export interface WebviewPersistedState {
  view: ViewMode;
  bytesPerRow: 8 | 16 | 32;
  endianness: Endianness;
  showInspector: boolean;
  scrollTop: number;
  activeFormat: string | null;
}

export interface FormatEditorInit {
  type: 'init';
  format: FormatDefinition | null;
  /** True when editing an existing writable format. */
  editing: boolean;
  scalarTypes: string[];
  compositeTypes: string[];
}

export type FormatEditorToHost =
  | { type: 'ready' }
  | { type: 'save'; format: FormatDefinition }
  | { type: 'validate'; format: FormatDefinition }
  | { type: 'openJsonFile' }
  | { type: 'cancel' };

export type FormatEditorFromHost =
  | FormatEditorInit
  | { type: 'validationResult'; errors: string[] }
  | { type: 'saved' };
