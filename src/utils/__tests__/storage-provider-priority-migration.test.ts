import { describe, it, expect, beforeEach, vi } from 'vitest';
import { settingsRepository } from '../storage/SettingsRepository.js';
import { StorageKeys } from '../storage/types.js';

describe('AI_PROVIDER_PRIORITY_LIST 自動マイグレーション', () => {
  beforeEach(() => {
    settingsRepository.clearCache();
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

  it('derives the existing AI_PROVIDER as the top-priority slot when AI_PROVIDER_PRIORITY_LIST is unset', async () => {
    const settings = await settingsRepository.getAll();
    expect(settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST]).toEqual([
      { provider: 'openai2' }
    ]);
  });
});
