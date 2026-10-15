import type { FieldColorRange } from '../core/FieldColors';
import { el } from './dom';
import { offsetHex } from '../core/humanize';

/** A bounded legend for the fields intersecting the visible raw bytes. */
export class FieldTags {
  private root: HTMLElement;
  private previous: FieldColorRange[] = [];
  private omitted = -1;
  private buttons: HTMLButtonElement[] = [];

  constructor(parent: HTMLElement, private onSelect: (range: FieldColorRange) => void) {
    this.root = el('div', { class: 'bv-field-tags', 'aria-label': 'Visible field names', hidden: true });
    parent.append(this.root);
  }

  render(ranges: readonly FieldColorRange[], start: number, end: number, maxTags: number, caret = -1): void {
    const visible = maxTags > 0 ? ranges.filter((r) => r.start < end && r.end > start) : [];
    const tags = visible.slice(0, maxTags);
    const omitted = visible.length - tags.length;
    this.root.hidden = tags.length === 0;
    if (omitted === this.omitted && tags.length === this.previous.length &&
        tags.every((tag, i) => tag === this.previous[i])) {
      this.updateActive(tags, caret);
      return;
    }
    this.previous = tags;
    this.omitted = omitted;
    this.root.replaceChildren();
    this.buttons = [];
    for (const range of tags) {
      const swatch = el('span', { class: 'bv-field-tag-swatch', 'aria-hidden': true });
      swatch.style.backgroundColor = range.color;
      const button = el('button', {
        class: 'bv-field-tag',
        title: `${range.name} · ${offsetHex(range.start)}–${offsetHex(range.end - 1)} · Click to select field`,
        onclick: () => this.onSelect(range),
      }, [swatch,
        el('span', { class: 'bv-field-tag-name', text: range.name }),
        el('span', {
          class: 'bv-field-tag-meta',
          text: `@${range.start}·${range.end - range.start}B`,
        }),
      ]);
      button.style.setProperty('--tag-color', range.color);
      button.style.setProperty('--tag-soft', `${range.color}26`);
      this.buttons.push(button);
      this.root.append(button);
    }
    this.updateActive(tags, caret);
    if (omitted) {
      this.root.append(el('span', {
        class: 'bv-field-tags-more', text: `+${omitted} more`,
        title: 'Increase Binary Viewer: Field Colors: Max Tags in settings to show more field names.',
      }));
    }
  }
  private updateActive(tags: readonly FieldColorRange[], caret: number): void {
    for (let i = 0; i < tags.length; i++) {
      const active = caret >= tags[i].start && caret < tags[i].end;
      this.buttons[i].classList.toggle('bv-field-tag-active', active);
      if (active) { this.buttons[i].setAttribute('aria-current', 'true'); }
      else { this.buttons[i].removeAttribute('aria-current'); }
    }
  }
}
