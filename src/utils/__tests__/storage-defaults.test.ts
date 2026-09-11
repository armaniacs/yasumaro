import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { StorageKeys } from '../storage/types.js';

describe('DEFAULT_SETTINGS.AI_PROVIDER_PRIORITY_LIST', () => {
  it('defaults to an empty array (derived from AI_PROVIDER in getSettings)', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.AI_PROVIDER_PRIORITY_LIST]).toEqual([]);
  });

  it('defaults SUMMARY_MIN_LENGTH to 10', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.SUMMARY_MIN_LENGTH]).toBe(10);
  });

  it('defaults OBSIDIAN_PORT to 27124', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.OBSIDIAN_PORT]).toBe('27124');
  });
});

describe('DEFAULT_SETTINGS retention bounds', () => {
  it('defaults record-layer retention to 365 days (conservative cap against indefinite retention)', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.SQLITE_RETENTION_DAYS]).toBe(365);
  });

  it('matches the UI retention options (unlimited/30/90/180/365)', () => {
    expect([30, 90, 180, 365]).toContain(DEFAULT_SETTINGS[StorageKeys.SQLITE_RETENTION_DAYS]);
  });
});

describe('DEFAULT_SETTINGS recording defaults (PBI 2026-09-05-10)', () => {
  it('defaults privacy consent to OFF (not recorded on first launch)', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.PRIVACY_CONSENT]).toBe(false);
  });

  it('defaults the onboarding-completed flag to false (shows the wizard on first launch)', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.ONBOARDING_WIZARD_COMPLETED]).toBe(false);
  });
});
