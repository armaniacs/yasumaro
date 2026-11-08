// @layer 1 — Infrastructure: minimal DI container for background services
/**
 * ServiceContainer — minimal DI container for background composition root.
 *
 * Hides the 17-member manual wiring behind register/resolve. singleton:true
 * factories are memoized; non-singleton factories produce a fresh instance on
 * each resolve. Tests can override a token with a fake via override().
 *
 * This is deliberately small: no scopes, no async factories — register/resolve
 * are keyed by the closed ServiceKey union, enough to make adding a
 * dependency one register() call instead of touching 3 type definitions.
 */

// The closed set of background composition keys. Mirrors compositionManifest;
// the wiring-startup pin (serviceContainer-keys.test.ts) asserts the two stay
// in sync in both directions, so adding a manifest entry without extending
// this list fails type-check (CompositionEntry.key) and tests. A typo'd or
// ad-hoc key is rejected at compile time instead of surfacing as a
// "no registration" failure at startup.
export const SERVICE_KEYS = [
  'sessionStore',
  'recordingCache',
  'headerDetector',
  'obsidian',
  'sqliteClient',
  'tabCache',
  'rateLimiter',
  'manualContentFetcher',
  'regenerateContentFetcher',
  'builtInAiClient',
  'remoteAiService',
  'aiProviderBreaker',
  'aiService',
  'settingsRepository',
  'perUrlMutexMap',
  'pendingWriteQueue',
  'pendingSqliteQueue',
  'offlineNetworkQueue',
  'reviewSummaryGenerator',
  'researchReportGenerator',
  'recordingPipeline',
  'dashboardSqliteHandler',
  'autoSavedBadgeTabs',
  'sessionAlarmService',
  'deferredMigrationRunner',
  'sessionReminderAlarms',
  'alarmRegistry',
  'recordingAdmission',
  'messageRouter',
] as const;

export type ServiceKey = (typeof SERVICE_KEYS)[number];

export class ServiceContainer {
  private readonly entries = new Map<string, { factory: () => unknown; singleton: boolean; instance?: unknown; hasInstance: boolean }>();

  register<T>(key: ServiceKey, factory: () => T, opts: { singleton?: boolean } = {}): void {
    this.entries.set(key, { factory: factory as () => unknown, singleton: opts.singleton ?? false, hasInstance: false });
  }

  resolve<T>(key: ServiceKey): T {
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

  has(key: ServiceKey): boolean {
    return this.entries.has(key);
  }

  /** Replace a registration with a fixed instance (for tests). */
  override<T>(key: ServiceKey, instance: T): void {
    this.entries.set(key, { factory: () => instance as unknown, singleton: true, instance: instance as unknown, hasInstance: true });
  }
}
