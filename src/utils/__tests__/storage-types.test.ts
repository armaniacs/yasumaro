import { describe, it, expect } from 'vitest';
import { StorageKeys } from '../storage/types.js';
import type { ProviderSlot, StorageKeyValues } from '../storage/types.js';

describe('AI_PROVIDER_PRIORITY_LIST', () => {
  it('defines the AI_PROVIDER_PRIORITY_LIST key in StorageKeys', () => {
    expect(StorageKeys.AI_PROVIDER_PRIORITY_LIST).toBe('ai_provider_priority_list');
  });

  it('requires provider and allows optional model in ProviderSlot', () => {
    const slotWithModel: ProviderSlot = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
    const slotWithoutModel: ProviderSlot = { provider: 'openai' };
    expect(slotWithModel.provider).toBe('gemini');
    expect(slotWithoutModel.model).toBeUndefined();
  });

  it('requires ProviderSlot[] for the AI_PROVIDER_PRIORITY_LIST key in StorageKeyValues', () => {
    const value: StorageKeyValues[typeof StorageKeys.AI_PROVIDER_PRIORITY_LIST] = [
      { provider: 'gemini' },
      { provider: 'openai', model: 'gpt-4o-mini' }
    ];
    expect(value).toHaveLength(2);
  });

  it('defines the SUMMARY_MIN_LENGTH key in StorageKeys', () => {
    expect(StorageKeys.SUMMARY_MIN_LENGTH).toBe('summary_min_length');
  });
});
