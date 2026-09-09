export type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) {
      continue;
    }
    if (k === 'class' || k === 'className') {
      node.className = String(v);
    } else if (k === 'text') {
      node.textContent = String(v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
