import { describe, it, expect } from 'vitest';
import { StorageKeys } from '../types.js';
import { DEFAULT_SETTINGS } from '../defaults.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../../utils/settingsSchemas.js';

describe('AI_PROVIDER_LAYOUT key', () => {
  it('StorageKeys exposes AI_PROVIDER_LAYOUT', () => {
    expect(StorageKeys.AI_PROVIDER_LAYOUT).toBe('ai_provider_layout');
  });
  it('DEFAULT_SETTINGS defaults to a', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.AI_PROVIDER_LAYOUT]).toBe('a');
  });
  it('GENERAL_SETTINGS_SCHEMA registers AI_PROVIDER_LAYOUT', () => {
    const keys = GENERAL_SETTINGS_SCHEMA.map(s => s.key);
    expect(keys).toContain(StorageKeys.AI_PROVIDER_LAYOUT);
  });
});
