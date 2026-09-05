import { describe, it, expect } from 'vitest';
import { API_KEY_FIELDS } from '../settingsMigration.js';

describe('settingsStore API_KEY_FIELDS', () => {
  it('6つのAPIキーフィールドをエクスポートしている', () => {
    expect(API_KEY_FIELDS).toEqual([
      'obsidian_api_key',
      'gemini_api_key',
      'openai_api_key',
      'openai_2_api_key',
      'provider_api_key',
      'github_pat',
    ]);
  });
});
