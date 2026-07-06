import { describe, it, expect } from 'vitest';
import { StorageKeys } from '../storage/types.js';
import type { ProviderSlot, StorageKeyValues } from '../storage/types.js';

describe('AI_PROVIDER_PRIORITY_LIST', () => {
  it('StorageKeysにAI_PROVIDER_PRIORITY_LISTキーが定義されている', () => {
    expect(StorageKeys.AI_PROVIDER_PRIORITY_LIST).toBe('ai_provider_priority_list');
  });

  it('ProviderSlot型はproviderが必須、modelが任意である', () => {
    const slotWithModel: ProviderSlot = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
    const slotWithoutModel: ProviderSlot = { provider: 'openai' };
    expect(slotWithModel.provider).toBe('gemini');
    expect(slotWithoutModel.model).toBeUndefined();
  });

  it('StorageKeyValuesはAI_PROVIDER_PRIORITY_LISTキーに対してProviderSlot[]を要求する', () => {
    const value: StorageKeyValues[typeof StorageKeys.AI_PROVIDER_PRIORITY_LIST] = [
      { provider: 'gemini' },
      { provider: 'openai', model: 'gpt-4o-mini' }
    ];
    expect(value).toHaveLength(2);
  });

  it('StorageKeysにSUMMARY_MIN_LENGTHキーが定義されている', () => {
    expect(StorageKeys.SUMMARY_MIN_LENGTH).toBe('summary_min_length');
  });
});
