/**
 * graphNodeA11y.ts
 * Shared keyboard/ARIA wiring for SVG graph nodes (tag/word/compare clusters).
 *
 * Graph nodes are the primary filter interaction ("click a node to filter
 * history") so they must be reachable and operable by keyboard
 * (WCAG 2.1.1) and carry an accessible name (WCAG 1.1.1).
 */
export function makeGraphNodeAccessible(
  circle: Element,
  label: string,
  onActivate: () => void,
): void {
  circle.setAttribute('tabindex', '0');
  circle.setAttribute('role', 'button');
  circle.setAttribute('aria-label', label);
  circle.addEventListener('keydown', (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      onActivate();
    }
  });
}
