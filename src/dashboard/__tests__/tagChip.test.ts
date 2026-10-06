// @vitest-environment jsdom
/**
 * tagChip.test.ts — createTagChip factory unit tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTagChip } from '../tagChip.js';

describe('createTagChip', () => {
  it('builds a standalone label button when onRemove is absent', () => {
    const onLabelClick = vi.fn();
    const el = createTagChip({
      label: '#tech',
      containerClass: 'default-category-item category-tag-btn',
      labelTitle: '「#tech」の履歴を表示',
      onLabelClick,
    });

    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toBe('default-category-item category-tag-btn');
    expect(el.textContent).toBe('#tech');
    expect((el as HTMLButtonElement).title).toBe('「#tech」の履歴を表示');
    (el as HTMLButtonElement).click();
    expect(onLabelClick).toHaveBeenCalledTimes(1);
  });

  it('builds div + label + remove button in order with dataset and aria-label', () => {
    const onRemove = vi.fn();
    const el = createTagChip({
      label: 'bank.com',
      containerClass: 'domain-tag',
      removeClass: 'domain-tag-remove',
      removeAriaLabel: 'Remove bank.com',
      removeDataset: { domain: 'bank.com' },
      onRemove,
    });

    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('domain-tag');
    expect(el.children.length).toBe(2);
    const [labelEl, removeBtn] = [el.children[0] as HTMLElement, el.children[1] as HTMLButtonElement];
    expect(labelEl.tagName).toBe('SPAN');
    expect(labelEl.textContent).toBe('bank.com');
    expect(removeBtn.tagName).toBe('BUTTON');
    expect(removeBtn.className).toBe('domain-tag-remove');
    expect(removeBtn.textContent).toBe('×');
    expect(removeBtn.getAttribute('aria-label')).toBe('Remove bank.com');
    expect(removeBtn.dataset.domain).toBe('bank.com');
    removeBtn.click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('supports a button label with its own click handler (user category shape)', () => {
    const onLabelClick = vi.fn();
    const onRemove = vi.fn();
    const el = createTagChip({
      label: '#custom',
      containerClass: 'user-category-item',
      labelClass: 'user-category-name category-tag-btn',
      labelTag: 'button',
      labelTitle: '「#custom」の履歴を表示',
      onLabelClick,
      removeClass: 'user-category-delete',
      removeAriaLabel: 'Delete custom',
      onRemove,
    });

    const labelEl = el.children[0] as HTMLButtonElement;
    expect(labelEl.tagName).toBe('BUTTON');
    expect(labelEl.className).toBe('user-category-name category-tag-btn');
    labelEl.click();
    expect(onLabelClick).toHaveBeenCalledTimes(1);
    (el.children[1] as HTMLButtonElement).click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders markup-looking labels as text (no HTML injection)', () => {
    const el = createTagChip({
      label: '<img src=x onerror=alert(1)>',
      containerClass: 'domain-tag',
      removeClass: 'domain-tag-remove',
      removeAriaLabel: 'Remove x',
      onRemove: vi.fn(),
    });
    expect(el.querySelector('img')).toBeNull();
    expect(el.children[0]?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
