/**
 * collectionSelectBuilder.ts
 *
 * Shared builders for the collection-target <select> controls (PBI 2026-11-11-04).
 *
 * The ask-history target, the research-report target, and the sort control
 * repeated the same shape: an all-records option, one option per saved
 * collection (newest-first), joined and wrapped in a <select>. Only the
 * wrapper attributes (CSS class / id / aria-label) and the sort's `selected`
 * flag differed. Both option builders funnel every value/label through
 * `escapeHtml`, which stays the single XSS SSOT; `selected` is absorbed as an
 * option flag so the sort control needs no inline ternary.
 */

import { escapeHtml } from '../../../utils/htmlEscape.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';

/** One <option> rendered by {@link buildSelectOptionsHtml}. */
export interface CollectionSelectOption {
  /** Raw (unescaped) option value; escaped inside the builder. */
  value: string;
  /** Raw (unescaped) option label; escaped inside the builder. */
  label: string;
  /** Renders as ` selected` when true (sort control only). */
  selected?: boolean;
}

/** Wrapper attributes for the <select> rendered by {@link buildSelectHtml}. */
export interface CollectionSelectAttrs {
  cssClass?: string;
  id?: string;
  ariaLabel?: string;
}

function renderOption(option: CollectionSelectOption): string {
  return `<option value="${escapeHtml(option.value)}"${option.selected === true ? ' selected' : ''}>${escapeHtml(option.label)}</option>`;
}

/**
 * Builds the escaped <option> list from a structured option array, applying
 * the `selected` flag per item.
 */
export function buildSelectOptionsHtml(options: CollectionSelectOption[]): string {
  return options.map(renderOption).join('');
}

/**
 * Builds the escaped <option> list for a collection target: the all-records
 * option first, then one option per saved collection newest-first
 * (updatedAt desc) — byte-identical to the inlined code it replaces.
 */
export function buildCollectionOptionsHtml(
  collections: Record<string, SavedCollection>,
  allLabel: string,
): string {
  const entries = Object.values(collections).sort((a, b) => b.updatedAt - a.updatedAt);
  return buildSelectOptionsHtml([{ value: '', label: allLabel }].concat(
    entries.map((c) => ({ value: c.id, label: c.name })),
  ));
}

/**
 * Wraps escaped <option> HTML in a <select> with the given attributes.
 * Attribute order (class, id, aria-label) matches the call sites it replaces.
 */
export function buildSelectHtml(optionsHtml: string, attrs: CollectionSelectAttrs = {}): string {
  return (
    `<select` +
    (attrs.cssClass !== undefined ? ` class="${escapeHtml(attrs.cssClass)}"` : '') +
    (attrs.id !== undefined ? ` id="${escapeHtml(attrs.id)}"` : '') +
    (attrs.ariaLabel !== undefined ? ` aria-label="${escapeHtml(attrs.ariaLabel)}"` : '') +
    `>${optionsHtml}</select>`
  );
}
