import { type NavigationRegistry } from './NavigationRegistry.js';

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
