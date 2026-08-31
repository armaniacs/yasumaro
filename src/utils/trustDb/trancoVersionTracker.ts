/**
 * trancoVersionTracker.ts
 * Tranco domain-list version tracking, extracted from trustDb.ts. Talks to
 * settingsStore (via injected getters, to avoid re-triggering the
 * trustDb.ts/settingsStore.ts circular-import workaround) instead of owning
 * its own storage access.
 */

import { logInfo } from '../logger.js';

export interface TrancoVersionTrackerDeps {
  getSettingsStore: () => Promise<typeof import('../storage.js')>;
  getStorageTypes: () => Promise<typeof import('../storage/types.js')>;
  /** Version baked into the extension build (presetDomains.ts TRANCO_VERSION). */
  currentVersion: string;
}

export class TrancoVersionTracker {
  constructor(private readonly deps: TrancoVersionTrackerDeps) {}

  getCurrentTrancoVersion(): string {
    return this.deps.currentVersion;
  }

  async getSavedTrancoVersion(): Promise<string | null> {
    const { getSettings } = await this.deps.getSettingsStore();
    const { StorageKeys } = await this.deps.getStorageTypes();
    const settings = await getSettings();
    return settings[StorageKeys.TRANCO_VERSION] || null;
  }

  async updateTrancoVersion(version: string, domains: string[]): Promise<void> {
    const { saveSettings } = await this.deps.getSettingsStore();
    const { StorageKeys } = await this.deps.getStorageTypes();
    await saveSettings({
      [StorageKeys.TRANCO_VERSION]: version,
      [StorageKeys.TRANCO_DOMAINS]: domains
    });
    logInfo('TrustDb', { version, domainCount: domains.length }, 'Tranco version updated');
  }

  async checkTrancoUpdate(): Promise<{ hasUpdate: boolean; oldVersion: string | null; newVersion: string }> {
    const savedVersion = await this.getSavedTrancoVersion();
    const currentVersion = this.getCurrentTrancoVersion();

    if (savedVersion !== currentVersion) {
      logInfo('TrustDb', { savedVersion, currentVersion }, 'Tranco version update detected');
      return {
        hasUpdate: true,
        oldVersion: savedVersion,
        newVersion: currentVersion
      };
    }

    return {
      hasUpdate: false,
      oldVersion: savedVersion,
      newVersion: currentVersion
    };
  }

  async getSavedTrancoDomains(): Promise<string[]> {
    const { getSettings } = await this.deps.getSettingsStore();
    const { StorageKeys } = await this.deps.getStorageTypes();
    const settings = await getSettings();
    return settings[StorageKeys.TRANCO_DOMAINS] || [];
  }
}
