/**
 * ServiceContainer — lightweight DI container for background services.
 *
 * Each service registers a lazy factory; resolve() memoizes the instance.
 * Tests can override individual services without rebuilding the whole graph.
 *
 * Usage:
 *   const container = new ServiceContainer();
 *   container.register('settings', () => new SettingsService());
 *   container.register('pipeline', () => createPipeline({ settings: container.resolve('settings') }));
 *   const pipeline = container.resolve<RecordingPipeline>('pipeline');
 */

export class ServiceContainer {
  private factories = new Map<string, () => unknown>();
  private instances = new Map<string, unknown>();

  register<T>(key: string, factory: () => T): void {
    if (this.factories.has(key)) {
      throw new Error(`ServiceContainer: duplicate register for "${key}"`);
    }
    this.factories.set(key, factory);
  }

  resolve<T>(key: string): T {
    if (this.instances.has(key)) {
      return this.instances.get(key) as T;
    }
    const factory = this.factories.get(key);
    if (!factory) {
      throw new Error(`ServiceContainer: no factory for "${key}"`);
    }
    const instance = factory();
    this.instances.set(key, instance);
    return instance as T;
  }

  /** Override an already-registered service (for tests). */
  override<T>(key: string, instance: T): void {
    this.instances.set(key, instance);
  }

  has(key: string): boolean {
    return this.factories.has(key) || this.instances.has(key);
  }
}
