import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { StorageKeys } from '../storage/types.js';

describe('DEFAULT_SETTINGS.AI_PROVIDER_PRIORITY_LIST', () => {
  it('デフォルトは空配列である（getSettings側でAI_PROVIDERからの導出を行う）', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.AI_PROVIDER_PRIORITY_LIST]).toEqual([]);
  });

  it('SUMMARY_MIN_LENGTHのデフォルトは10である', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.SUMMARY_MIN_LENGTH]).toBe(10);
  });
});
