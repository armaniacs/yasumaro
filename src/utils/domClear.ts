// @layer 0 — Foundation: element-clearing seam shared by all UI renderers.

/**
 * Remove all children of an element without raw `innerHTML = ''`.
 * Central seam so future sanitization policy changes apply in one place.
 *
 * Pure over the passed Element: no `document` / `chrome` reference, so it can
 * live in Layer 0 (Foundation) and a renderer in any UI layer may import it
 * without inventing an upward sibling-layer edge (dev-docs/LAYERS.md).
 */
export function clearElement(el: Element | null): void {
  if (!el) return;
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}
