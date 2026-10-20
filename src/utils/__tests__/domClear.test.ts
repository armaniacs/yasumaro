// @vitest-environment jsdom
/**
 * domClear.test.ts — canonical element-clearing seam (AGENTS.md: clearElement
 * from src/utils/domClear.ts is the canonical way to empty an element; popup
 * re-exports it as a compatibility shim).
 *
 * Pins the contract: children and descendants removed, the element itself and
 * its own listeners survive, and a null element is a no-op. Lightweight unit
 * tests over the public API — no golden fixtures.
 */

import { describe, it, expect } from 'vitest';
import { clearElement } from '../domClear.js';

function buildContainer(): HTMLElement {
  const container = document.createElement('div');
  const child = document.createElement('span');
  child.textContent = 'child';
  const nested = document.createElement('em');
  nested.textContent = 'nested';
  child.appendChild(nested);
  container.appendChild(child);
  container.appendChild(document.createTextNode('text node'));
  document.body.appendChild(container);
  return container;
}

describe('clearElement — canonical element-clearing seam', () => {
  it('removes all children, including nested descendants and text nodes', () => {
    const container = buildContainer();

    clearElement(container);

    expect(container.childNodes).toHaveLength(0);
    expect(container.textContent).toBe('');
  });

  it('keeps the element itself in the DOM (BDD boundary: element survives)', () => {
    const container = buildContainer();

    clearElement(container);

    expect(container.isConnected).toBe(true);
    expect(document.body.contains(container)).toBe(true);
  });

  it('keeps the element usable with its own listeners after clearing', () => {
    const container = document.createElement('div');
    container.appendChild(document.createElement('span'));
    document.body.appendChild(container);
    let clicks = 0;
    container.addEventListener('click', () => { clicks += 1; });

    clearElement(container);

    container.dispatchEvent(new Event('click'));
    expect(clicks).toBe(1);
  });

  it('detaches the removed children from the document', () => {
    const container = buildContainer();
    const child = container.firstElementChild as HTMLElement;

    clearElement(container);

    expect(child.isConnected).toBe(false);
  });

  it('is idempotent on an already-empty element', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    clearElement(container);

    expect(() => clearElement(container)).not.toThrow();
    expect(container.childNodes).toHaveLength(0);
  });

  it('accepts null as a no-op', () => {
    expect(() => clearElement(null)).not.toThrow();
  });
});
