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
  type: FieldTypeName;
  /**
   * Absolute byte offset from the start of the file. If omitted the field is
   * placed immediately after the previous sibling field ("packed").
   */
  offset?: number;
  /** Explicit size in bytes. Required for `bytes`/`binary`/string types. */
  size?: number;
  /** For string types: number of characters/code units. */
  length?: number;
  /** For `array`: number of elements. */
  count?: number;
  /** For `array`: the element type (a nested field definition without a name is allowed). */
  items?: FieldDefinition;
  /** For `struct`: nested fields. Offsets inside are relative to this struct. */
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
  /** Top-level fields. */
  fields: FieldDefinition[];
}

/** Where a loaded format came from (affects override precedence and editability). */
export type FormatSource = 'builtin' | 'global' | 'workspace';

export interface LoadedFormat {
  definition: FormatDefinition;
  source: FormatSource;
  /** Absolute path / uri string of the backing file, when applicable. */
  uri?: string;
}
