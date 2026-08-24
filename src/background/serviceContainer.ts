// @layer 1 — Infrastructure: minimal DI container for background services
/**
 * ServiceContainer — minimal DI container for background composition root.
 *
 * Hides the 17-member manual wiring behind register/resolve. singleton:true
 * factories are memoized; non-singleton factories produce a fresh instance on
 * each resolve. Tests can override a token with a fake via override().
 *
 * This is deliberately small (50 lines): no scopes, no async factories, no
 * token types beyond string — enough to make adding a dependency one register()
 * call instead of touching 3 type definitions.
 */

export class ServiceContainer {
  private readonly entries = new Map<string, { factory: () => unknown; singleton: boolean; instance?: unknown; hasInstance: boolean }>();

  register<T>(key: string, factory: () => T, opts: { singleton?: boolean } = {}): void {
    this.entries.set(key, { factory: factory as () => unknown, singleton: opts.singleton ?? false, hasInstance: false });
  }

  resolve<T>(key: string): T {
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`ServiceContainer: no registration for "${key}"`);
    if (entry.singleton) {
      if (!entry.hasInstance) {
        entry.instance = entry.factory();
        entry.hasInstance = true;
      }
      return entry.instance as T;
    }
    return entry.factory() as T;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Replace a registration with a fixed instance (for tests). */
  override<T>(key: string, instance: T): void {
    this.entries.set(key, { factory: () => instance as unknown, singleton: true, instance: instance as unknown, hasInstance: true });
  }
}
