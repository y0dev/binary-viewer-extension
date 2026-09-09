import { el, clear } from '../dom';
import { FORMAT_EDITOR_CSS } from './styles';
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

/** A node in the working tree: a primitive field or a nested structure. */
interface EditNode {
  id: string;
  kind: 'field' | 'struct';
  name: string;
  offset: string;
  // field-only
  type: string;
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

interface Model {
  name: string;
  description: string;
  version: string;
  author: string;
  fileExtensions: string;
  endianness: 'little' | 'big';
  magicOffset: string;
  magicBytes: string;
  tree: EditNode[];
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

function emptyNode(kind: 'field' | 'struct'): EditNode {
  return {
    id: uid(),
    kind,
    name: kind === 'struct' ? 'NewStruct' : 'field',
    offset: '',
    type: 'uint8',
    size: '',
    length: '',
    endianness: '',
    description: '',
    advanced: '',
    children: [],
    collapsed: false,
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
    tree: (def?.fields ?? []).map(fieldToNode),
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
  return def;
}

// ---- tree operations -------------------------------------------------

interface Location {
  list: EditNode[];
  index: number;
}

function locate(id: string, list: EditNode[] = model.tree): Location | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return { list, index: i };
    }
    const deeper = locate(id, list[i].children);
    if (deeper) {
      return deeper;
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

function addChild(structId: string, kind: 'field' | 'struct'): void {
  const loc = locate(structId);
  if (!loc) {
    return;
  }
  const s = loc.list[loc.index];
  s.collapsed = false;
  s.children.push(emptyNode(kind));
  changed();
}

function addTop(kind: 'field' | 'struct'): void {
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

  // ---- fields tree ----
  wrap.append(el('h2', { text: 'Fields & structures' }));
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'Offsets inside a structure are relative to that structure. Leave Offset blank to pack after the previous sibling. Leave a structure Size blank to size it automatically from its fields.',
    }),
  );
  const tree = el('div', { class: 'fe-tree' });
  for (const node of model.tree) {
    renderNode(tree, node, 0);
  }
  wrap.append(tree);
  wrap.append(
    el('div', { class: 'fe-row fe-add-row' }, [
      el('button', { class: 'secondary', text: '+ Add Field', onclick: () => addTop('field') }),
      el('button', { class: 'secondary', text: '+ Add Structure', onclick: () => addTop('struct') }),
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

const ALL_TYPES = () => [...(init?.scalarTypes ?? []), ...(init?.compositeTypes ?? [])];

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
  } else {
    head.append(el('span', { class: 'fe-toggle fe-toggle-empty', text: '' }));
  }

  head.append(bindInput(node, 'name', { placeholder: 'name', width: 150 }));

  if (node.kind === 'field') {
    const typeSel = el('select', {
      onchange: (e) => {
        node.type = (e.target as HTMLSelectElement).value;
        scheduleValidate();
      },
    }) as HTMLSelectElement;
    for (const t of ALL_TYPES()) {
      typeSel.append(el('option', { value: t, text: t }));
    }
    if (!ALL_TYPES().includes(node.type)) {
      typeSel.append(el('option', { value: node.type, text: node.type }));
    }
    typeSel.value = node.type;
    head.append(typeSel);
  } else {
    head.append(el('span', { class: 'fe-badge-type', text: 'structure' }));
  }

  head.append(
    labelled('offset', bindInput(node, 'offset', { placeholder: 'auto', width: 70 })),
    labelled('size', bindInput(node, 'size', { placeholder: node.kind === 'struct' ? 'auto' : '', width: 60 })),
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
      el('div', { class: 'fe-row fe-add-row', style: `margin-left:${(depth + 1) * 18}px` }, [
        el('button', {
          class: 'secondary icon-text',
          text: '+ Field',
          onclick: () => addChild(node.id, 'field'),
        }),
        el('button', {
          class: 'secondary icon-text',
          text: '+ Structure',
          onclick: () => addChild(node.id, 'struct'),
        }),
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
