import { describe, it, expect } from 'vitest';
import { API_KEY_FIELDS } from '../settingsStore.js';

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

  it('storage.js バレル経由でも同じ値をエクスポートしている', async () => {
    const { API_KEY_FIELDS: fromBarrel } = await import('../../storage.js');
    expect(fromBarrel).toEqual(API_KEY_FIELDS);
  });
});
