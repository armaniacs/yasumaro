import { type NavigationRegistry } from './NavigationRegistry.js';

let _registry: NavigationRegistry | null = null;

export function setRegistry(r: NavigationRegistry): void {
  _registry = r;
}

export function getRegistry(): NavigationRegistry {
  if (!_registry) throw new Error('NavigationRegistry not initialized');
  return _registry;
}
