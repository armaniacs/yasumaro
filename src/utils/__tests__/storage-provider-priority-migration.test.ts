import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSettings, clearSettingsCache, StorageKeys } from '../storage.js';

describe('AI_PROVIDER_PRIORITY_LIST 自動マイグレーション', () => {
  beforeEach(() => {
    clearSettingsCache();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn((keys, callback?: (result: Record<string, unknown>) => void) => {
            const result = {
              settings: {
                [StorageKeys.AI_PROVIDER]: 'openai2',
                [StorageKeys.OPENAI_2_API_KEY]: 'dummy-test-apikey-value'
              },
              settings_migrated: true
            };
            if (callback) {
              callback(result);
              return;
            }
            return Promise.resolve(result);
          })
        }
      }
    });
  });

  it('AI_PROVIDER_PRIORITY_LISTが未設定の場合、既存のAI_PROVIDERを1位スロットとして導出する', async () => {
    const settings = await getSettings();
    expect(settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST]).toEqual([
      { provider: 'openai2' }
    ]);
  });
});
