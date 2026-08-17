/**
 * trancoVersionTracker.test.ts
 * Unit tests for TrancoVersionTracker, extracted from trustDb.ts's Tranco
 * version-tracking methods (getCurrentTrancoVersion/getSavedTrancoVersion/
 * updateTrancoVersion/checkTrancoUpdate/getSavedTrancoDomains).
 */
import { vi } from 'vitest';
import { TrancoVersionTracker } from '../trancoVersionTracker.js';

vi.mock('../../logger.js', () => ({
  logInfo: vi.fn(),
}));

function makeTracker(currentVersion = 'v2') {
  const getSettings = vi.fn();
  const saveSettings = vi.fn().mockResolvedValue(undefined);
  const StorageKeys = { TRANCO_VERSION: 'tranco_version', TRANCO_DOMAINS: 'tranco_domains' };

  const tracker = new TrancoVersionTracker({
    getSettingsStore: async () => ({ getSettings, saveSettings } as never),
    getStorageTypes: async () => ({ StorageKeys } as never),
    currentVersion,
  });

  return { tracker, getSettings, saveSettings, StorageKeys };
}

describe('TrancoVersionTracker', () => {
  it('getCurrentTrancoVersion returns the injected build version', () => {
    const { tracker } = makeTracker('v3');
    expect(tracker.getCurrentTrancoVersion()).toBe('v3');
  });

  it('getSavedTrancoVersion returns the stored version', async () => {
    const { tracker, getSettings } = makeTracker();
    getSettings.mockResolvedValue({ tranco_version: 'v1' });

    await expect(tracker.getSavedTrancoVersion()).resolves.toBe('v1');
  });

  it('getSavedTrancoVersion returns null when nothing is stored', async () => {
    const { tracker, getSettings } = makeTracker();
    getSettings.mockResolvedValue({});

    await expect(tracker.getSavedTrancoVersion()).resolves.toBeNull();
  });

  it('updateTrancoVersion saves version and domains together in one call', async () => {
    const { tracker, saveSettings } = makeTracker();

    await tracker.updateTrancoVersion('v2', ['a.com', 'b.com']);

    expect(saveSettings).toHaveBeenCalledWith({
      tranco_version: 'v2',
      tranco_domains: ['a.com', 'b.com'],
    });
  });

  it('checkTrancoUpdate reports hasUpdate=true when saved and current versions differ', async () => {
    const { tracker, getSettings } = makeTracker('v2');
    getSettings.mockResolvedValue({ tranco_version: 'v1' });

    const result = await tracker.checkTrancoUpdate();

    expect(result).toEqual({ hasUpdate: true, oldVersion: 'v1', newVersion: 'v2' });
  });

  it('checkTrancoUpdate reports hasUpdate=false when versions match', async () => {
    const { tracker, getSettings } = makeTracker('v2');
    getSettings.mockResolvedValue({ tranco_version: 'v2' });

    const result = await tracker.checkTrancoUpdate();

    expect(result).toEqual({ hasUpdate: false, oldVersion: 'v2', newVersion: 'v2' });
  });

  it('getSavedTrancoDomains returns the stored domain list', async () => {
    const { tracker, getSettings } = makeTracker();
    getSettings.mockResolvedValue({ tranco_domains: ['a.com'] });

    await expect(tracker.getSavedTrancoDomains()).resolves.toEqual(['a.com']);
  });

  it('getSavedTrancoDomains returns an empty array when nothing is stored', async () => {
    const { tracker, getSettings } = makeTracker();
    getSettings.mockResolvedValue({});

    await expect(tracker.getSavedTrancoDomains()).resolves.toEqual([]);
  });
});
