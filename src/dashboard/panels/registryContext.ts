import { type NavigationRegistry } from './NavigationRegistry.js';
import { type PanelInitMap } from './types.js';

let _registry: NavigationRegistry | null = null;

export function setRegistry(r: NavigationRegistry): void {
  _registry = r;
}

export function getRegistry(): NavigationRegistry {
  if (!_registry) throw new Error('NavigationRegistry not initialized');
  return _registry;
}

/**
 * The registry if panels have been registered, otherwise null.
 *
 * WHY the registry can still be unset: `src/dashboard/main.ts` calls
 * `setRegistry()` in its own module body, but ESM evaluates a module's
 * imports first (NavigationRegistry → DashboardBootstrapper → panelFactories
 * → every panel module), so anything those modules do at import time runs
 * before the registry exists. Unit tests that import a panel module without
 * main.ts are the same case. getRegistry() would throw in both.
 *
 * This is NOT the `entrypoints/options/main.ts` ordering the comment used to
 * claim: that entrypoint imports `src/dashboard/main.js`, not `dashboard.js`,
 * and main.ts registers the registry before it calls initDashboard().
 *
 * No production caller uses tryGetRegistry() today — the fire-and-forget
 * navigations (tryNavigate / tryNavigateTyped) wrap getRegistry() in their
 * own try/catch. It stays as the typed "may not be there yet" accessor for
 * those and for tests; converting this module to injection is a separate,
 * wider change (see the PBI note) because every panel module would have to
 * take the registry as a parameter.
 */
export function tryGetRegistry(): NavigationRegistry | null {
  return _registry;
}

/**
 * Fire-and-forget navigate() that swallows both a synchronous throw from
 * getRegistry() (registry not initialized, e.g. in unit tests) and an
 * async rejection from navigate() itself, running onFailure for either.
 */
export function tryNavigate(panelId: string, init?: Record<string, unknown>, onFailure?: () => void): void {
  try {
    void getRegistry().navigate(panelId, init).catch(() => onFailure?.());
  } catch {
    onFailure?.();
  }
}

/**
 * Typed counterpart of tryNavigate() for call sites that pass a
 * PanelInitMap-typed init and want navigateTyped()'s narrower typing
 * preserved (e.g. tagClusterPanel's searchTag jump).
 */
export function tryNavigateTyped<K extends keyof PanelInitMap>(
  panelId: K,
  init?: PanelInitMap[K],
  onFailure?: () => void,
): void {
  try {
    void getRegistry().navigateTyped(panelId, init).catch(() => onFailure?.());
  } catch {
    onFailure?.();
  }
}
