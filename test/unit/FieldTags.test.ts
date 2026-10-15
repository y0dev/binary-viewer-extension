import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import { FieldTags } from '../../src/webview/FieldTags';
import { computeFieldColorRanges, FieldColorRange } from '../../src/core/FieldColors';

describe('Raw field-name tags', () => {
  let dom: JSDOM;
  let root: HTMLElement;
  let tags: FieldTags;
  let selected: FieldColorRange[];
  let savedDocument: PropertyDescriptor | undefined;
  const ranges = computeFieldColorRanges([
    { name: 'Header', offset: 0, size: 8, depth: 0 },
    { name: 'Nested child', offset: 0, size: 4, depth: 1 },
    { name: 'Payload', offset: 8, size: 16, depth: 0 },
    { name: '<img src=x onerror=alert(1)>', offset: 24, size: 8, depth: 0 },
  ]);

  beforeEach(() => {
    savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    dom = new JSDOM('<div id="root"></div>');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    root = dom.window.document.getElementById('root')!;
    selected = [];
    tags = new FieldTags(root, (range) => selected.push(range));
  });

  afterEach(() => {
    dom.window.close();
    if (savedDocument) { Object.defineProperty(globalThis, 'document', savedDocument); }
    else { Reflect.deleteProperty(globalThis, 'document'); }
  });

  it('pairs visible top-level field names with their byte colors and selects their range', () => {
    tags.render(ranges, 4, 20, 8);
    const buttons = root.querySelectorAll('button');
    assert.deepStrictEqual(Array.from(buttons, (b) => b.querySelector('.bv-field-tag-name')!.textContent), ['Header', 'Payload']);
    const swatch = buttons[0].querySelector('span')!;
    const expected = dom.window.document.createElement('span');
    expected.style.backgroundColor = ranges[0].color;
    assert.strictEqual(swatch.style.backgroundColor, expected.style.backgroundColor);
    buttons[1].click();
    assert.deepStrictEqual(selected, [ranges[1]]);
  });

  it('limits tags, reports omitted fields, and applies a changed limit immediately', () => {
    tags.render(ranges, 0, 32, 1);
    assert.strictEqual(root.querySelectorAll('button').length, 1);
    assert.strictEqual(root.querySelector('.bv-field-tags-more')!.textContent, '+2 more');
    tags.render(ranges, 0, 32, 3);
    assert.strictEqual(root.querySelectorAll('button').length, 3);
    assert.strictEqual(root.querySelector('.bv-field-tags-more'), null);
  });

  it('hides and clears tags when disabled or when no colored fields are visible', () => {
    tags.render(ranges, 0, 32, 8);
    tags.render(ranges, 0, 32, 0);
    assert.strictEqual(root.querySelectorAll('button').length, 0);
    assert.ok((root.firstElementChild as HTMLElement).hidden);
    tags.render(ranges, 32, 64, 8);
    assert.ok((root.firstElementChild as HTMLElement).hidden);
  });

  it('updates on scroll and excludes fields ending at the visible start', () => {
    tags.render(ranges, 0, 8, 8);
    assert.strictEqual(root.querySelector('.bv-field-tag-name')!.textContent, 'Header');
    tags.render(ranges, 8, 24, 8);
    assert.strictEqual(root.querySelectorAll('button').length, 1);
    assert.strictEqual(root.querySelector('.bv-field-tag-name')!.textContent, 'Payload');
  });

  it('shows field offsets and sizes and follows the caret without rebuilding focused chips', () => {
    tags.render(ranges, 0, 24, 8, 0);
    const first = root.querySelector('button')!;
    assert.strictEqual(first.getAttribute('aria-current'), 'true');
    assert.match(first.querySelector('.bv-field-tag-meta')!.textContent!, /^@0·8B$/);
    first.focus();
    tags.render(ranges, 0, 24, 8, 12);
    assert.strictEqual(root.querySelector('button'), first);
    assert.strictEqual(dom.window.document.activeElement, first);
    assert.strictEqual(first.hasAttribute('aria-current'), false);
    assert.strictEqual(root.querySelectorAll('button')[1].getAttribute('aria-current'), 'true');
  });

  it('renders arbitrary field names as text rather than HTML', () => {
    tags.render(ranges, 24, 32, 8);
    assert.strictEqual(root.querySelector('img'), null);
    assert.strictEqual(root.querySelector('.bv-field-tag-name')!.textContent, ranges[2].name);
  });
});
