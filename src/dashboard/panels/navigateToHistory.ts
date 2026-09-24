import { tryNavigateTyped } from './registryContext.js';

/**
 * Shared "jump to history filtered by tag" navigation for dashboard panels.
 *
 * Navigates panel-sqlite-history via the registry; when the registry is not
 * initialized (page bootstrap, unit tests) or navigateTyped rejects, falls
 * back to the legacy 'navigate-to-tag' CustomEvent whose detail is the raw
 * tag string — that detail shape is the long-standing cross-panel contract
 * and must not be wrapped in an object.
 */
export function navigateToHistoryWithTag(tag: string): void {
  const fallback = (): void => {
    document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: tag }));
  };
  tryNavigateTyped('panel-sqlite-history', { searchTag: tag }, fallback);
}
