import { describe, it, expect } from 'vitest';
import { StorageKeys } from '../types.js';
import { DEFAULT_SETTINGS } from '../defaults.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../../utils/settingsSchemas.js';

describe('AI_PROVIDER_LAYOUT key', () => {
  it('StorageKeysにAI_PROVIDER_LAYOUTが存在する', () => {
    expect(StorageKeys.AI_PROVIDER_LAYOUT).toBe('ai_provider_layout');
  });
  it('DEFAULT_SETTINGSでデフォルトは a', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.AI_PROVIDER_LAYOUT]).toBe('a');
  });
  it('GENERAL_SETTINGS_SCHEMAにAI_PROVIDER_LAYOUTが登録されている', () => {
    const keys = GENERAL_SETTINGS_SCHEMA.map(s => s.key);
    expect(keys).toContain(StorageKeys.AI_PROVIDER_LAYOUT);
  });
});
