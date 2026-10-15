import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import type { SearchBar } from '../../src/webview/SearchBar';
import { Store, AppState } from '../../src/webview/state';
import type { HostToWebview, WebviewToHost } from '../../src/types/messages';

type SearchRequest = Extract<WebviewToHost, { type: 'search' }>;

describe('SearchBar', () => {
  let dom: JSDOM;
  let root: HTMLElement;
  let bar: SearchBar;
  let messages: WebviewToHost[];
  let selections: number[];
  const saved = new Map<string, PropertyDescriptor | undefined>();

  before(() => {
    for (const key of ['document', 'window', 'acquireVsCodeApi']) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    }
    Object.defineProperty(globalThis, 'acquireVsCodeApi', {
      configurable: true,
      value: () => ({ postMessage: (msg: WebviewToHost) => messages.push(msg), getState: () => ({}), setState: () => undefined }),
    });
  });

  after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) { Object.defineProperty(globalThis, key, descriptor); }
      else { Reflect.deleteProperty(globalThis, key); }
    }
  });

  beforeEach(() => {
    dom = new JSDOM('<div id="search"></div>');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    root = dom.window.document.getElementById('search')!;
    messages = [];
    selections = [];
    const state: AppState = {
      fileSize: 1000, fileName: 'test.bin', view: 'raw', bytesPerRow: 16,
      byteGroup: '1', endianness: 'little', showInspector: true, fieldHighlight: false,
      caret: 0, anchor: 0, selection: { start: 0, length: 1 }, formats: [],
      activeFormat: null, detectedFormat: null, parsed: [], parseError: null,
      activeNodeId: null, sections: [], activeSectionName: null,
      blockSizeBytes: 65536, maxSearchResults: 5000, fieldColorMaxTags: 8, fieldColorBrightness: 20, baseAddress: 0, formatBaseAddress: null,
    };
    // Load after installing the webview API; type-only imports do not acquire it.
    const Constructor = (require('../../src/webview/SearchBar') as typeof import('../../src/webview/SearchBar')).SearchBar;
    bar = new Constructor(root, new Store(state), { onSelect: (offset) => selections.push(offset) });
    bar.show();
    input('AB');
  });

  afterEach(() => dom.window.close());

  function input(value: string): void {
    const field = root.querySelector('input[type="text"]') as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new dom.window.Event('input'));
  }

  function click(text: string): void {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text);
    assert.ok(button, `missing ${text} button`);
    button.click();
  }

  function request(): SearchRequest {
    const last = messages.filter((m): m is SearchRequest => m.type === 'search').at(-1);
    assert.ok(last);
    return last;
  }

  function result(req: SearchRequest, offsets: number[], done: boolean, scannedTo = 1000, truncated = false): void {
    const msg: Extract<HostToWebview, { type: 'searchResult' }> = {
      type: 'searchResult', requestId: req.requestId, query: req.query,
      matches: offsets.map((offset) => ({ offset, length: 1 })), done, scannedTo, truncated,
    };
    bar.onResult(msg);
  }

  function status(): string { return root.querySelector('[role="status"]')!.textContent!; }

  it('accumulates progress batches and selects only the first match automatically', () => {
    click('All');
    const req = request();
    result(req, [10], false, 500);
    assert.ok(bar.busy);
    assert.match(status(), /50%.*1 matches/);
    result(req, [20], true);
    assert.strictEqual(bar.busy, false);
    assert.deepStrictEqual(selections, [10]);
    assert.strictEqual(status(), '1 / 2');
    click('>');
    assert.deepStrictEqual(selections, [10, 20]);
  });

  it('rejects responses and errors from an older query', () => {
    click('>');
    const old = request();
    input('CD');
    click('>');
    const current = request();
    result(old, [100], true);
    bar.onError(old.requestId, 'old failure');
    assert.deepStrictEqual(selections, []);
    assert.ok(bar.busy);
    result(current, [200], true);
    assert.deepStrictEqual(selections, [200]);
    assert.ok(messages.some((m) => m.type === 'cancelSearch' && m.requestId === old.requestId));
  });

  it('cancels an active scan and ignores late results', () => {
    click('All');
    const req = request();
    result(req, [10], false, 500);
    click('Cancel');
    assert.strictEqual(bar.busy, false);
    assert.match(status(), /Cancelled.*incomplete/);
    result(req, [20], true);
    click('>');
    assert.deepStrictEqual(selections, [10, 10]);
    assert.match(status(), /cancelled \(incomplete\)/);
  });

  it('preserves the result-limit warning during navigation', () => {
    click('All');
    result(request(), [10, 20], true, 21, true);
    assert.match(status(), /result limit reached \(incomplete\)/);
    click('>');
    assert.match(status(), /^2 \/ 2.*incomplete/);
  });

  it('validates patterns inline without dispatching a broken search', () => {
    input('F');
    click('>');
    assert.strictEqual(messages.filter((m) => m.type === 'search').length, 0);
    assert.match(status(), /even number/);
    assert.strictEqual(root.querySelector('input[type="text"]')!.getAttribute('aria-invalid'), 'true');
    input('FF');
    assert.strictEqual(root.querySelector('input[type="text"]')!.hasAttribute('aria-invalid'), false);
  });

  it('shows host errors inline and clears the busy state', () => {
    click('>');
    bar.onError(request().requestId, 'File could not be read');
    assert.strictEqual(bar.busy, false);
    assert.strictEqual(status(), 'File could not be read');
  });

  it('keeps partial results marked incomplete after a read error', () => {
    click('All');
    const req = request();
    result(req, [10, 20], false, 500);
    bar.onError(req.requestId, 'Read failed');
    assert.match(status(), /Read failed.*incomplete/);
    click('>');
    assert.match(status(), /scan failed \(incomplete\)/);
  });

  it('cancels when the search bar is closed', () => {
    click('>');
    const req = request();
    bar.hide();
    assert.strictEqual(bar.busy, false);
    assert.ok(messages.some((m) => m.type === 'cancelSearch' && m.requestId === req.requestId));
    result(req, [10], true);
    assert.deepStrictEqual(selections, []);
  });
});
