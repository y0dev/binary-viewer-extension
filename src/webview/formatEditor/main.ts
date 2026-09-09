import { el, clear } from '../dom';
import { FORMAT_EDITOR_CSS } from './styles';
import { parseArrayShorthand } from '../../core/FieldSyntax';
import type { FormatDefinition, FieldDefinition, MagicSpec, BitSpec } from '../../types/format';
import type {
  FormatEditorFromHost,
  FormatEditorToHost,
  FormatEditorInit,
} from '../../types/messages';

interface Api {
  postMessage(msg: FormatEditorToHost): void;
}
declare function acquireVsCodeApi(): Api;
const vscode = acquireVsCodeApi();
const post = (m: FormatEditorToHost) => vscode.postMessage(m);

const style = document.createElement('style');
style.textContent = FORMAT_EDITOR_CSS;
document.head.append(style);

const app = document.getElementById('app')!;

let init: FormatEditorInit | null = null;
let seq = 1;
const uid = () => `e${seq++}`;

/** A node in the working tree: a primitive field, a nested structure, or an array. */
interface EditNode {
  id: string;
  kind: 'field' | 'struct' | 'array';
  name: string;
  offset: string;
  /** field: data type or a structure name. array: the element type. */
  type: string;
  /** array only: element count. */
  count: string;
  size: string;
  length: string;
  endianness: string;
  description: string;
  advanced: string;
  advancedError?: string;
  // struct-only
  children: EditNode[];
  collapsed: boolean;
}

/** A reusable structure definition (the `structures` map). */
interface EditStruct {
  id: string;
  name: string;
  description: string;
  children: EditNode[];
  collapsed: boolean;
}

interface Model {
  name: string;
  description: string;
  version: string;
  author: string;
  fileExtensions: string;
  endianness: 'little' | 'big';
  magicOffset: string;
  magicBytes: string;
  structs: EditStruct[];
  tree: EditNode[];
  /** Raw JSON text for the `sections` array (memory-map view). '' == none. */
  sectionsJson: string;
  sectionsError?: string;
}

let model: Model;

window.addEventListener('message', (ev: MessageEvent<FormatEditorFromHost>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    init = msg;
    model = toModel(msg.format);
    render();
  } else if (msg.type === 'validationResult') {
    showErrors(msg.errors);
  } else if (msg.type === 'saved') {
    showErrors([]);
    flashSaved();
  }
});

post({ type: 'ready' });

// ---- model <-> definition ----------------------------------------------

const KNOWN_KEYS = new Set(['name', 'type', 'offset', 'size', 'length', 'endianness', 'description']);

function looksLikeBitSpecs(fields: unknown): boolean {
  return (
    Array.isArray(fields) &&
    fields.length > 0 &&
    typeof (fields[0] as Partial<BitSpec>).bits === 'string'
  );
}

function isNestedStructure(f: FieldDefinition): boolean {
  if (!Array.isArray(f.fields)) {
    return false;
  }
  if (looksLikeBitSpecs(f.fields)) {
    return false;
  }
  // typeless container, or explicit type:"struct"
  return !f.type || f.type === 'struct';
}

function emptyNode(kind: EditNode['kind']): EditNode {
  return {
    id: uid(),
    kind,
    name: kind === 'struct' ? 'NewStruct' : kind === 'array' ? 'items' : 'field',
    offset: '',
    type: 'uint8',
    count: kind === 'array' ? '4' : '',
    size: '',
    length: '',
    endianness: '',
    description: '',
    advanced: '',
    children: [],
    collapsed: false,
  };
}

function emptyStruct(): EditStruct {
  return { id: uid(), name: 'Record', description: '', children: [emptyNode('field')], collapsed: false };
}

function cloneNode(n: EditNode): EditNode {
  return {
    ...n,
    id: uid(),
    children: n.children.map(cloneNode),
  };
}

function fieldToNode(f: FieldDefinition): EditNode {
  if (isNestedStructure(f)) {
    const node = emptyNode('struct');
    node.name = f.name ?? '';
    node.offset = f.offset === undefined ? '' : String(f.offset);
    node.size = f.size === undefined ? '' : String(f.size);
    node.endianness = f.endianness ?? '';
    node.description = f.description ?? '';
    node.children = (f.fields as FieldDefinition[]).map(fieldToNode);
    return node;
  }
  const shorthand = parseArrayShorthand(f.type);
  const STRING_OR_SIZED = new Set(['char', 'ascii', 'utf8', 'utf16', 'string', 'bytes', 'hex', 'binary', 'padding']);
  if (f.type === 'array' || (shorthand && !STRING_OR_SIZED.has(shorthand.base))) {
    const node = emptyNode('array');
    node.name = f.name ?? '';
    node.offset = f.offset === undefined ? '' : String(f.offset);
    if (shorthand) {
      node.count = String(shorthand.count);
      node.type = shorthand.base;
      node.size = f.items?.size !== undefined ? String(f.items.size) : '';
    } else {
      node.count = f.count === undefined ? '' : String(f.count);
      node.type = f.items?.type ?? 'uint8';
      node.size =
        f.items?.size !== undefined ? String(f.items.size) : f.size !== undefined ? String(f.size) : '';
    }
    node.endianness = f.endianness ?? '';
    node.description = f.description ?? '';
    return node;
  }
  const node = emptyNode('field');
  const advanced: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (!KNOWN_KEYS.has(k)) {
      advanced[k] = v;
    }
  }
  node.name = f.name ?? '';
  node.type = f.type ?? 'uint8';
  node.offset = f.offset === undefined ? '' : String(f.offset);
  node.size = f.size === undefined ? '' : String(f.size);
  node.length = f.length === undefined ? '' : String(f.length);
  node.endianness = f.endianness ?? '';
  node.description = f.description ?? '';
  node.advanced = Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : '';
  return node;
}

function toModel(def: FormatDefinition | null): Model {
  const magic: MagicSpec | undefined = def
    ? Array.isArray(def.magic)
      ? def.magic[0]
      : def.magic
    : undefined;
  return {
    name: def?.name ?? 'New Binary Format',
    description: def?.description ?? '',
    version: def?.version ?? '',
    author: def?.author ?? '',
    fileExtensions: (def?.fileExtensions ?? []).join(', '),
    endianness: def?.endianness ?? 'little',
    magicOffset: magic ? String(magic.offset) : '',
    magicBytes: magic?.bytes ?? '',
    structs: Object.entries(def?.structures ?? {}).map(([name, body]) => ({
      id: uid(),
      name,
      description: body.description ?? '',
      collapsed: false,
      children: (body.fields ?? []).map(fieldToNode),
    })),
    tree: (def?.fields ?? []).map(fieldToNode),
    sectionsJson:
      def?.sections && def.sections.length
        ? JSON.stringify(def.sections, null, 2)
        : '',
  };
}

function num(s: string): number | undefined {
  const t = s.trim();
  if (t === '') {
    return undefined;
  }
  const n = t.toLowerCase().startsWith('0x') ? parseInt(t, 16) : Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function nodeToField(node: EditNode): FieldDefinition {
  if (node.kind === 'struct') {
    const f: FieldDefinition = {
      name: node.name.trim(),
      fields: node.children.map(nodeToField),
    };
    const off = num(node.offset);
    if (off !== undefined) {
      f.offset = off;
    }
    const sz = num(node.size);
    if (sz !== undefined) {
      f.size = sz;
    }
    if (node.endianness === 'little' || node.endianness === 'big') {
      f.endianness = node.endianness;
    }
    if (node.description.trim()) {
      f.description = node.description.trim();
    }
    return f;
  }

  if (node.kind === 'array') {
    const items: FieldDefinition = { name: 'item', type: node.type.trim() };
    const elemSize = num(node.size);
    if (elemSize !== undefined) {
      items.size = elemSize;
    }
    const f: FieldDefinition = {
      name: node.name.trim(),
      type: 'array',
      count: num(node.count) ?? 0,
      items,
    };
    const off = num(node.offset);
    if (off !== undefined) {
      f.offset = off;
    }
    if (node.endianness === 'little' || node.endianness === 'big') {
      f.endianness = node.endianness;
    }
    if (node.description.trim()) {
      f.description = node.description.trim();
    }
    return f;
  }

  const f: FieldDefinition = { name: node.name.trim(), type: node.type.trim() };
  const off = num(node.offset);
  if (off !== undefined) {
    f.offset = off;
  }
  const sz = num(node.size);
  if (sz !== undefined) {
    f.size = sz;
  }
  const len = num(node.length);
  if (len !== undefined) {
    f.length = len;
  }
  if (node.endianness === 'little' || node.endianness === 'big') {
    f.endianness = node.endianness;
  }
  if (node.description.trim()) {
    f.description = node.description.trim();
  }
  node.advancedError = undefined;
  if (node.advanced.trim()) {
    try {
      const extra = JSON.parse(node.advanced);
      if (extra && typeof extra === 'object') {
        Object.assign(f, extra);
      }
    } catch (e) {
      node.advancedError = (e as Error).message;
    }
  }
  return f;
}

function buildDefinition(): FormatDefinition {
  const def: FormatDefinition = {
    name: model.name.trim(),
    fields: model.tree.map(nodeToField),
    endianness: model.endianness,
  };

  const structs: Record<string, { fields: FieldDefinition[]; description?: string }> = {};
  for (const s of model.structs) {
    const key = s.name.trim();
    if (!key || s.children.length === 0) {
      continue;
    }
    structs[key] = { fields: s.children.map(nodeToField) };
    if (s.description.trim()) {
      structs[key].description = s.description.trim();
    }
  }
  if (Object.keys(structs).length) {
    def.structures = structs;
  }
  if (model.description.trim()) {
    def.description = model.description.trim();
  }
  if (model.version.trim()) {
    def.version = model.version.trim();
  }
  if (model.author.trim()) {
    def.author = model.author.trim();
  }
  const exts = model.fileExtensions
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (exts.length) {
    def.fileExtensions = exts;
  }
  if (model.magicBytes.trim()) {
    def.magic = {
      offset: Number(model.magicOffset.trim() || '0') || 0,
      bytes: model.magicBytes.trim(),
    };
  }

  model.sectionsError = undefined;
  if (model.sectionsJson.trim()) {
    try {
      const parsed = JSON.parse(model.sectionsJson);
      if (Array.isArray(parsed)) {
        def.sections = parsed;
      } else if (parsed && Array.isArray(parsed.sections)) {
        def.sections = parsed.sections;
      } else {
        model.sectionsError = 'expected a JSON array of { name, start, length, flags?, display? }';
      }
    } catch (e) {
      model.sectionsError = (e as Error).message;
    }
  }

  // A sections-only format has no fields.
  if (def.fields && def.fields.length === 0 && def.sections && def.sections.length) {
    delete def.fields;
  }
  return def;
}

// ---- tree operations -------------------------------------------------

interface Location {
  list: EditNode[];
  index: number;
}

function locateIn(id: string, list: EditNode[]): Location | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return { list, index: i };
    }
    const deeper = locateIn(id, list[i].children);
    if (deeper) {
      return deeper;
    }
  }
  return null;
}

function locate(id: string, list?: EditNode[]): Location | null {
  if (list) {
    return locateIn(id, list);
  }
  const inTree = locateIn(id, model.tree);
  if (inTree) {
    return inTree;
  }
  for (const s of model.structs) {
    const hit = locateIn(id, s.children);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function moveNode(id: string, delta: number): void {
  const loc = locate(id);
  if (!loc) {
    return;
  }
  const j = loc.index + delta;
  if (j < 0 || j >= loc.list.length) {
    return;
  }
  [loc.list[loc.index], loc.list[j]] = [loc.list[j], loc.list[loc.index]];
  changed();
}

function deleteNode(id: string): void {
  const loc = locate(id);
  if (!loc) {
    return;
  }
  loc.list.splice(loc.index, 1);
  changed();
}

function duplicateNode(id: string): void {
  const loc = locate(id);
  if (!loc) {
    return;
  }
  const copy = cloneNode(loc.list[loc.index]);
  copy.name = copy.name ? `${copy.name}_copy` : 'field_copy';
  loc.list.splice(loc.index + 1, 0, copy);
  changed();
}

/** Move a node into the immediately-preceding sibling, if that sibling is a struct. */
function indentNode(id: string): void {
  const loc = locate(id);
  if (!loc || loc.index === 0) {
    return;
  }
  const prev = loc.list[loc.index - 1];
  if (prev.kind !== 'struct') {
    return;
  }
  const [node] = loc.list.splice(loc.index, 1);
  prev.collapsed = false;
  prev.children.push(node);
  changed();
}

/** Move a node out of its parent struct, placing it right after that struct. */
function outdentNode(id: string): void {
  // Find the node's list and, separately, which struct owns that list.
  const found = findWithParent(id, model.tree, null);
  if (!found || !found.parent) {
    return; // already at the top level
  }
  const { parent } = found;
  const parentLoc = locate(parent.id);
  if (!parentLoc) {
    return;
  }
  const idx = parent.children.findIndex((c) => c.id === id);
  const [node] = parent.children.splice(idx, 1);
  parentLoc.list.splice(parentLoc.index + 1, 0, node);
  changed();
}

function findWithParent(
  id: string,
  list: EditNode[],
  parent: EditNode | null,
): { node: EditNode; parent: EditNode | null } | null {
  for (const n of list) {
    if (n.id === id) {
      return { node: n, parent };
    }
    const deeper = findWithParent(id, n.children, n);
    if (deeper) {
      return deeper;
    }
  }
  return null;
}

function addChild(structId: string, kind: EditNode['kind']): void {
  const loc = locate(structId);
  if (!loc) {
    return;
  }
  const s = loc.list[loc.index];
  s.collapsed = false;
  s.children.push(emptyNode(kind));
  changed();
}

/** Add a child to a top-level reusable-structure definition. */
function addStructChild(structDefId: string, kind: EditNode['kind']): void {
  const s = model.structs.find((x) => x.id === structDefId);
  if (!s) {
    return;
  }
  s.collapsed = false;
  s.children.push(emptyNode(kind));
  changed();
}

function addTop(kind: EditNode['kind']): void {
  model.tree.push(emptyNode(kind));
  changed();
}

// ---- rendering -----------------------------------------------------

let errorBox: HTMLElement;
let previewBox: HTMLElement;
let debounce: number | undefined;

function changed(): void {
  render();
  scheduleValidate();
}

function scheduleValidate(): void {
  updatePreview();
  if (debounce) {
    clearTimeout(debounce);
  }
  debounce = window.setTimeout(() => {
    post({ type: 'validate', format: buildDefinition() });
  }, 250);
}

function collectAdvErrors(list: EditNode[], pathPrefix: string, out: string[]): void {
  list.forEach((n, i) => {
    const p = `${pathPrefix}${n.name || i}`;
    if (n.advancedError) {
      out.push(`${p}: advanced JSON is invalid — ${n.advancedError}`);
    }
    collectAdvErrors(n.children, `${p} > `, out);
  });
}

function updatePreview(): void {
  const def = buildDefinition();
  previewBox.textContent = JSON.stringify(def, null, 2);
  const advErrors: string[] = [];
  collectAdvErrors(model.tree, '', advErrors);
  for (const s of model.structs) {
    collectAdvErrors(s.children, `${s.name || 'structure'} > `, advErrors);
  }
  if (model.sectionsError) {
    advErrors.push(`sections: invalid JSON — ${model.sectionsError}`);
  }
  if (advErrors.length) {
    showErrors(advErrors);
  }
}

function showErrors(errors: string[]): void {
  clear(errorBox);
  if (errors.length === 0) {
    errorBox.append(el('span', { class: 'fe-ok', text: 'Valid' }));
    return;
  }
  errorBox.append(el('div', { text: errors.join('\n') }));
}

function flashSaved(): void {
  const note = el('span', { class: 'fe-ok', text: '  Saved.' });
  errorBox.append(note);
  setTimeout(() => note.remove(), 2000);
}

function textField(
  label: string,
  value: string,
  onChange: (v: string) => void,
  opts: { placeholder?: string; width?: number } = {},
): HTMLElement {
  const input = el('input', {
    type: 'text',
    value,
    placeholder: opts.placeholder ?? '',
    oninput: (e) => {
      onChange((e.target as HTMLInputElement).value);
      scheduleValidate();
    },
  }) as HTMLInputElement;
  if (opts.width) {
    input.style.width = `${opts.width}px`;
  }
  return el('div', { class: 'fe-field' }, [el('label', { text: label }), input]);
}

function render(): void {
  if (!init) {
    return;
  }
  clear(app);
  const wrap = el('div', { class: 'fe-wrap' });

  wrap.append(
    el('h1', { text: init.editing ? 'Edit Binary Format' : 'Create Binary Format' }),
    el('div', {
      class: 'fe-hint',
      text: 'Definitions are pure data and are stored as JSON in global storage. Nothing here executes code.',
    }),
  );

  // ---- meta ----
  wrap.append(el('h2', { text: 'Format' }));
  wrap.append(
    el('div', { class: 'fe-row' }, [
      textField('Name', model.name, (v) => (model.name = v), { width: 260 }),
      textField('Version', model.version, (v) => (model.version = v), { width: 90 }),
      textField('Author', model.author, (v) => (model.author = v), { width: 140 }),
      (() => {
        const sel = el('select', {
          onchange: (e) => {
            model.endianness = (e.target as HTMLSelectElement).value as 'little' | 'big';
            scheduleValidate();
          },
        }) as HTMLSelectElement;
        sel.append(
          el('option', { value: 'little', text: 'Little Endian' }),
          el('option', { value: 'big', text: 'Big Endian' }),
        );
        sel.value = model.endianness;
        return el('div', { class: 'fe-field' }, [el('label', { text: 'Default Endianness' }), sel]);
      })(),
    ]),
  );
  wrap.append(
    el('div', { class: 'fe-row' }, [
      textField('Description', model.description, (v) => (model.description = v), { width: 420 }),
      textField(
        'File Extensions (comma-separated)',
        model.fileExtensions,
        (v) => (model.fileExtensions = v),
        { width: 260, placeholder: '.fw, .img' },
      ),
    ]),
  );
  wrap.append(
    el('div', { class: 'fe-row' }, [
      textField('Magic Offset', model.magicOffset, (v) => (model.magicOffset = v), {
        width: 90,
        placeholder: '0',
      }),
      textField('Magic Bytes (hex)', model.magicBytes, (v) => (model.magicBytes = v), {
        width: 260,
        placeholder: '46 57 01 00',
      }),
    ]),
  );

  // ---- reusable structures ----
  wrap.append(el('h2', { text: 'Reusable structures' }));
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'Define a record layout once here, then pick its name as the "type" of a field or an array element. Ideal for large arrays of records. Child offsets are relative to the structure.',
    }),
  );
  const structsWrap = el('div', { class: 'fe-tree' });
  for (const s of model.structs) {
    renderStructDef(structsWrap, s);
  }
  wrap.append(structsWrap);
  wrap.append(
    addRow(0, [['+ Add Structure Definition', () => {
      model.structs.push(emptyStruct());
      changed();
    }]]),
  );

  // ---- fields tree ----
  wrap.append(el('h2', { text: 'Fields' }));
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'Offsets inside a structure are relative to that structure. Leave Offset blank to pack after the previous sibling. Leave a structure Size blank to size it automatically from its fields.',
    }),
  );
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'For a fixed array — e.g. 8 floats — use "+ Add Array": set count to 8 and the element type to float32. In JSON you can also write the type as "float32[8]" (or "int16[24]", "Sample[100]" for a reusable structure).',
    }),
  );
  const tree = el('div', { class: 'fe-tree' });
  for (const node of model.tree) {
    renderNode(tree, node, 0);
  }
  wrap.append(tree);
  wrap.append(
    addRow(0, [
      ['+ Add Field', () => addTop('field')],
      ['+ Add Array', () => addTop('array')],
      ['+ Add Structure', () => addTop('struct')],
    ]),
  );

  // ---- sections / memory map ----
  wrap.append(el('h2', { text: 'Sections (memory map)' }));
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'Optional. A JSON array shown in the Sections view: each entry { "name", "start", "length" (or "end"), "flags"?, "display"? }. start/length accept 0x hex. Leave blank to derive rows from the top-level fields instead.',
    }),
  );
  const sectionsTa = el('textarea', {
    value: model.sectionsJson,
    placeholder:
      '[\n  { "name": "main", "start": "0x0000", "length": "0x4000", "flags": "r-x", "display": true },\n  { "name": "config", "start": "0x4000", "length": "0x1000", "flags": "rw-", "display": true }\n]',
    oninput: (e) => {
      model.sectionsJson = (e.target as HTMLTextAreaElement).value;
      scheduleValidate();
    },
  }) as HTMLTextAreaElement;
  sectionsTa.style.minHeight = '120px';
  wrap.append(sectionsTa);
  wrap.append(
    el('div', { class: 'fe-row fe-add-row' }, [
      el('button', {
        class: 'secondary',
        text: '+ Insert example section',
        onclick: () => {
          const example = { name: 'main', start: '0x0000', length: '0x4000', flags: 'r-x', display: true };
          let arr: unknown[] = [];
          try {
            const p = JSON.parse(model.sectionsJson || '[]');
            arr = Array.isArray(p) ? p : [];
          } catch {
            arr = [];
          }
          arr.push(example);
          model.sectionsJson = JSON.stringify(arr, null, 2);
          sectionsTa.value = model.sectionsJson;
          scheduleValidate();
        },
      }),
    ]),
  );

  // ---- preview + errors ----
  wrap.append(el('h2', { text: 'Validation' }));
  errorBox = el('div', { class: 'fe-errors' });
  wrap.append(errorBox);
  wrap.append(el('h2', { text: 'JSON Preview' }));
  previewBox = el('pre', { class: 'fe-preview' });
  wrap.append(previewBox);

  // ---- actions ----
  wrap.append(
    el('div', { class: 'fe-actions' }, [
      el('button', { text: 'Save', onclick: () => post({ type: 'save', format: buildDefinition() }) }),
      el('button', {
        class: 'secondary',
        text: 'Validate',
        onclick: () => post({ type: 'validate', format: buildDefinition() }),
      }),
      el('button', { class: 'secondary', text: 'Close', onclick: () => post({ type: 'cancel' }) }),
    ]),
  );

  app.append(wrap);
  updatePreview();
  post({ type: 'validate', format: buildDefinition() });
}

const BASE_TYPES = () => [...(init?.scalarTypes ?? []), ...(init?.compositeTypes ?? [])];
const structNames = () =>
  model.structs.map((s) => s.name.trim()).filter((n) => n && !BASE_TYPES().includes(n));
const ALL_TYPES = () => [...BASE_TYPES(), ...structNames()];

/** A <select> of every data type, with the user's reusable structures grouped separately. */
function typeSelect(value: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = el('select', {
    onchange: (e) => {
      onChange((e.target as HTMLSelectElement).value);
      scheduleValidate();
    },
  }) as HTMLSelectElement;
  for (const t of BASE_TYPES()) {
    sel.append(el('option', { value: t, text: t }));
  }
  const structs = structNames();
  if (structs.length) {
    const group = el('optgroup', { label: 'structures' });
    for (const t of structs) {
      group.append(el('option', { value: t, text: t }));
    }
    sel.append(group);
  }
  if (value && !ALL_TYPES().includes(value)) {
    sel.append(el('option', { value, text: `${value} (?)` }));
  }
  sel.value = value;
  return sel;
}

function bindInput(node: EditNode, key: keyof EditNode, opts: { placeholder?: string; width?: number } = {}) {
  const input = el('input', {
    type: 'text',
    value: String(node[key] ?? ''),
    placeholder: opts.placeholder ?? '',
    oninput: (e) => {
      (node[key] as string) = (e.target as HTMLInputElement).value;
      scheduleValidate();
    },
  }) as HTMLInputElement;
  if (opts.width) {
    input.style.width = `${opts.width}px`;
  }
  return input;
}

function renderNode(parent: HTMLElement, node: EditNode, depth: number): void {
  const rowEl = el('div', {
    class: `fe-node fe-node-${node.kind}`,
    style: `margin-left:${depth * 18}px`,
  });

  const head = el('div', { class: 'fe-node-head' });

  if (node.kind === 'struct') {
    head.append(
      el('span', {
        class: 'fe-toggle',
        text: node.collapsed ? '▶' : '▼',
        onclick: () => {
          node.collapsed = !node.collapsed;
          render();
        },
      }),
      el('span', { class: 'fe-badge', text: 'STRUCT' }),
    );
  } else if (node.kind === 'array') {
    head.append(
      el('span', { class: 'fe-toggle fe-toggle-empty', text: '' }),
      el('span', { class: 'fe-badge', text: 'ARRAY' }),
    );
  } else {
    head.append(el('span', { class: 'fe-toggle fe-toggle-empty', text: '' }));
  }

  head.append(bindInput(node, 'name', { placeholder: 'name', width: 150 }));

  if (node.kind === 'field') {
    head.append(typeSelect(node.type, (v) => (node.type = v)));
  } else if (node.kind === 'array') {
    head.append(
      labelled('count', bindInput(node, 'count', { width: 60, placeholder: 'N' })),
      el('span', { class: 'fe-inline-label', text: 'of' }),
      typeSelect(node.type, (v) => (node.type = v)),
    );
  } else {
    head.append(el('span', { class: 'fe-badge-type', text: 'structure' }));
  }

  head.append(
    labelled('offset', bindInput(node, 'offset', { placeholder: 'auto', width: 70 })),
    labelled(
      node.kind === 'array' ? 'elem size' : 'size',
      bindInput(node, 'size', { placeholder: node.kind === 'struct' ? 'auto' : '', width: 60 }),
    ),
  );

  if (node.kind === 'field') {
    head.append(labelled('len', bindInput(node, 'length', { width: 55 })));
  }

  const endSel = el('select', {
    onchange: (e) => {
      node.endianness = (e.target as HTMLSelectElement).value;
      scheduleValidate();
    },
  }) as HTMLSelectElement;
  endSel.append(
    el('option', { value: '', text: 'endian: default' }),
    el('option', { value: 'little', text: 'LE' }),
    el('option', { value: 'big', text: 'BE' }),
  );
  endSel.value = node.endianness;
  head.append(endSel);

  // action buttons
  head.append(
    el('span', { class: 'fe-node-actions' }, [
      iconBtn('↑', 'Move up', () => moveNode(node.id, -1)),
      iconBtn('↓', 'Move down', () => moveNode(node.id, 1)),
      iconBtn('⧉', 'Duplicate', () => duplicateNode(node.id)),
      iconBtn('⇤', 'Move out of structure', () => outdentNode(node.id)),
      iconBtn('⇥', 'Move into previous structure', () => indentNode(node.id)),
      iconBtn('✕', 'Delete', () => deleteNode(node.id)),
    ]),
  );

  rowEl.append(head);

  // description + advanced (second line)
  const line2 = el('div', { class: 'fe-node-line2' }, [
    labelled('description', bindInput(node, 'description', { width: 320 })),
  ]);
  if (node.kind === 'field') {
    const adv = el('details', { class: 'fe-adv' }, [
      el('summary', {
        text: 'advanced: bits / enum / items / timestamp' + (node.advancedError ? '  (invalid JSON)' : ''),
      }),
      el('textarea', {
        value: node.advanced,
        placeholder:
          '{ "fields": [ { "name": "Enabled", "bits": "0" } ] }   or   { "enum": { "0": "off", "1": "on" } }',
        oninput: (e) => {
          node.advanced = (e.target as HTMLTextAreaElement).value;
          scheduleValidate();
        },
      }),
    ]);
    line2.append(adv);
  }
  rowEl.append(line2);

  parent.append(rowEl);

  if (node.kind === 'struct' && !node.collapsed) {
    const kids = el('div', { class: 'fe-children' });
    for (const child of node.children) {
      renderNode(kids, child, depth + 1);
    }
    kids.append(
      addRow((depth + 1) * 18, [
        ['+ Field', () => addChild(node.id, 'field')],
        ['+ Array', () => addChild(node.id, 'array')],
        ['+ Structure', () => addChild(node.id, 'struct')],
      ]),
    );
    parent.append(kids);
  }
}

function addRow(marginLeft: number, buttons: [string, () => void][]): HTMLElement {
  return el(
    'div',
    { class: 'fe-row fe-add-row', style: `margin-left:${marginLeft}px` },
    buttons.map(([text, onclick]) => el('button', { class: 'secondary icon-text', text, onclick })),
  );
}

function renderStructDef(parent: HTMLElement, s: EditStruct): void {
  const card = el('div', { class: 'fe-node fe-node-structdef' });
  const head = el('div', { class: 'fe-node-head' }, [
    el('span', {
      class: 'fe-toggle',
      text: s.collapsed ? '▶' : '▼',
      onclick: () => {
        s.collapsed = !s.collapsed;
        render();
      },
    }),
    el('span', { class: 'fe-badge', text: 'DEF' }),
    (() => {
      const input = el('input', {
        type: 'text',
        value: s.name,
        placeholder: 'StructureName',
        oninput: (e) => {
          s.name = (e.target as HTMLInputElement).value;
          scheduleValidate();
        },
      }) as HTMLInputElement;
      input.style.width = '180px';
      return input;
    })(),
    labelled(
      'description',
      (() => {
        const input = el('input', {
          type: 'text',
          value: s.description,
          oninput: (e) => {
            s.description = (e.target as HTMLInputElement).value;
            scheduleValidate();
          },
        }) as HTMLInputElement;
        input.style.width = '260px';
        return input;
      })(),
    ),
    el('span', { class: 'fe-node-actions' }, [
      iconBtn('✕', 'Delete structure definition', () => {
        model.structs = model.structs.filter((x) => x.id !== s.id);
        changed();
      }),
    ]),
  ]);
  card.append(head);
  parent.append(card);

  if (!s.collapsed) {
    const kids = el('div', { class: 'fe-children' });
    for (const child of s.children) {
      renderNode(kids, child, 1);
    }
    kids.append(
      addRow(18, [
        ['+ Field', () => addStructChild(s.id, 'field')],
        ['+ Array', () => addStructChild(s.id, 'array')],
        ['+ Structure', () => addStructChild(s.id, 'struct')],
      ]),
    );
    parent.append(kids);
  }
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  return el('span', { class: 'fe-inline-field' }, [
    el('label', { class: 'fe-inline-label', text: label }),
    control,
  ]);
}

function iconBtn(text: string, title: string, onClick: () => void): HTMLElement {
  return el('button', { class: 'icon secondary', text, title, onclick: onClick });
}
