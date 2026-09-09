/**
 * Declarative binary-format definition types.
 *
 * These types are shared by the extension host and the webview. They describe a
 * format purely as data — there is deliberately no mechanism to embed executable
 * code in a definition (see SECURITY notes in the README).
 */

export type Endianness = 'little' | 'big';

/** Every scalar type the parser understands out of the box. */
export type ScalarTypeName =
  | 'uint8'
  | 'int8'
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'uint64'
  | 'int64'
  | 'float32'
  | 'float64'
  // convenience aliases
  | 'byte'
  | 'bool'
  | 'boolean'
  | 'char'
  | 'float'
  | 'double';

/** Higher-level field kinds that need extra configuration on the field. */
export type CompositeTypeName =
  | 'bytes' // raw byte array, shown as hex
  | 'hex' // alias for bytes
  | 'binary' // raw bytes shown as bit strings
  | 'ascii' // fixed-length ASCII string
  | 'utf8'
  | 'utf16'
  | 'string' // alias for ascii
  | 'enum'
  | 'flags' // bit-field container
  | 'bitfield'
  | 'timestamp'
  | 'struct'
  | 'array'
  | 'padding';

export type FieldTypeName = ScalarTypeName | CompositeTypeName | string;

/** A single bit or contiguous bit range inside a flags/bitfield field. */
export interface BitSpec {
  name: string;
  /** "0", "3", "1-4" (inclusive, LSB = bit 0). */
  bits: string;
  description?: string;
  /** Optional enum mapping applied to the extracted value. */
  enum?: Record<string, string | number> | EnumEntry[];
  /** If true, render as true/false. Default: true only when the range is 1 bit. */
  boolean?: boolean;
}

export interface EnumEntry {
  value: number | string;
  name: string;
  description?: string;
}

export interface FieldDefinition {
  name: string;
  /**
   * The data type for a *primitive* field. Omit `type` entirely for a nested
   * structure — a field with a `fields` array and no `type` is treated as a
   * container. A field must define exactly one of `type` or nested `fields`
   * (the bit-field form `{ type: "uint8", fields: [ { bits } ] }` is the one
   * intentional exception).
   */
  type?: FieldTypeName;
  /**
   * Byte offset. At the top level this is absolute from the start of the file;
   * inside a nested structure it is **relative to that structure**. If omitted
   * the field is placed immediately after the previous sibling ("packed").
   */
  offset?: number;
  /**
   * Explicit size in bytes. Required for `bytes`/`binary`/string types.
   * Optional for a structure — when given it is the structure's total size;
   * when omitted the size is computed from the largest child end offset.
   */
  size?: number;
  /** For string types: number of characters/code units. */
  length?: number;
  /** For `array`: number of elements. */
  count?: number;
  /** For `array`: the element type (a nested field definition without a name is allowed). */
  items?: FieldDefinition;
  /**
   * Nested content:
   *  - `FieldDefinition[]` — a nested structure (with or without `type: "struct"`).
   *    Child offsets are relative to this structure.
   *  - `BitSpec[]` — bit-field breakdown of an integer container.
   */
  fields?: FieldDefinition[] | BitSpec[];
  /** Per-field endianness override. */
  endianness?: Endianness;
  description?: string;
  /** For `enum` and scalar types with an enum overlay. */
  enum?: Record<string, string | number> | EnumEntry[];
  /** For `timestamp`. */
  timestamp?: {
    /** Underlying integer width in bytes. Default 4. */
    size?: 4 | 8;
    /** 's' (seconds, default) or 'ms'. */
    unit?: 's' | 'ms';
    /** Epoch. 'unix' (default) or 'y2k' (2000-01-01) or a numeric epoch in ms. */
    epoch?: 'unix' | 'y2k' | number;
  };
  /** Display hint: 'hex' | 'dec' | 'bin' | 'auto'. */
  display?: 'hex' | 'dec' | 'bin' | 'auto';
  /** Value multiplier / offset for scaled sensor values: value * scale + bias. */
  scale?: number;
  bias?: number;
  /** Unit label appended to the displayed value (e.g. "°C", "mV"). */
  unit?: string;
}

export interface MagicSpec {
  offset: number;
  /** Space/'0x'-separated hex bytes, e.g. "46 57 01 00" or "0x46 0x57". */
  bytes: string;
  /** Optional bitmask applied before comparison (same length as bytes). */
  mask?: string;
}

/**
 * A named region of the file for the Sections / memory-map view. `start` and
 * `length` accept a number or a hex/decimal string (`"0x8000"`, `"4096"`,
 * `"1000h"`). `flags` and `display` are optional, user-defined columns.
 */
export interface SectionDefinition {
  /** Section title, e.g. "main", ".text", "Bootloader". */
  name: string;
  /** Start address / file offset. */
  start: number | string;
  /** Size in bytes. Either this or `end` must be given. */
  length?: number | string;
  /** End address (exclusive). Alternative to `length`. */
  end?: number | string;
  /** Permission string, typically `rwx` / `r-x` / `rw-` (free-form, shown verbatim). */
  flags?: string;
  /** Whether the section is shown as visible ("Yes" / "No"). Default: true. */
  display?: boolean;
  description?: string;
}

/**
 * A reusable structure body. Referenced from a field by `"type": "<name>"`;
 * the extension inlines it before parsing. `fields` offsets are relative to the
 * referencing field, exactly like an inline nested structure.
 */
export interface StructBody {
  fields: FieldDefinition[];
  /** Explicit total size; otherwise computed from the largest child end. */
  size?: number;
  endianness?: Endianness;
  description?: string;
}

export interface FormatDefinition {
  /** Unique, human-readable name. Used as the storage key. */
  name: string;
  description?: string;
  version?: string;
  author?: string;
  /** File extensions this format applies to, with or without leading dot. */
  fileExtensions?: string[];
  /** Default endianness for all fields. Default: 'little'. */
  endianness?: Endianness;
  /** One or more magic-byte signatures. Any match counts. */
  magic?: MagicSpec | MagicSpec[];
  /**
   * Reusable named structures. A field (or an array's `items`) can then set
   * `"type": "<key>"` instead of repeating a `fields` block — handy for large
   * arrays of records.
   */
  structures?: Record<string, StructBody>;
  /** Top-level fields. Optional when `sections` is provided. */
  fields?: FieldDefinition[];
  /** Named regions for the Sections / memory-map view. */
  sections?: SectionDefinition[];
}

/**
 * Where a loaded format came from (affects override precedence and editability).
 * Precedence, lowest to highest: builtin < global < external < workspace.
 * `external` = a folder listed in `binaryViewer.formatDirectories`.
 */
export type FormatSource = 'builtin' | 'global' | 'external' | 'workspace';

export interface LoadedFormat {
  definition: FormatDefinition;
  source: FormatSource;
  /** Absolute path / uri string of the backing file, when applicable. */
  uri?: string;
}
