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
 * Use this from code that can run before `src/dashboard/main.ts` has executed.
 * `entrypoints/options/main.ts` imports dashboard.ts before main.ts, so
 * dashboard.ts's own bootstrap runs while the registry is still unset —
 * getRegistry() would throw there.
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
