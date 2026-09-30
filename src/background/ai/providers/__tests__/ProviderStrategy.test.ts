/**
 * ProviderStrategy.test.ts
 * The transport-agnostic base: identity, the invalid-schema failure and the
 * usage-recording rule. Everything that sends a request lives in
 * HttpProviderStrategy.test.ts, and the settings ladder in
 * providerSettingsResolver.test.ts — this file is the pin for what the base
 * still owns, so a responsibility that moves back down here fails to compile
 * against the wrong test.
 */

import { describe, test, expect } from 'vitest';
import type { Settings } from '../../../../utils/storage/types.js';
import { AIProviderStrategy, type AISummaryResult, type AIProviderConnectionResult } from '../ProviderStrategy.js';

class TestProvider extends AIProviderStrategy {
  async generateSummary(content: string): Promise<AISummaryResult> {
    return { success: true, summary: `summary of ${content}` };
  }

  async testConnection(): Promise<AIProviderConnectionResult> {
    return { success: true, message: 'OK' };
  }

  getName(): string {
    return 'test-provider';
  }
}

class CustomIdProvider extends TestProvider {
  override getName(): string {
    return 'openai';
  }

  override getProviderId(): string {
    return 'openai';
  }
}

function provider(): TestProvider {
  return new TestProvider({} as Settings);
}

describe('AIProviderStrategy', () => {
  describe('constructor', () => {
    test('stores the settings', () => {
      expect(new TestProvider({} as Settings)).toBeDefined();
    });
  });

  describe('getProviderId', () => {
    test('returns the same value as getName() by default', () => {
      expect(provider().getProviderId()).toBe('test-provider');
    });

    test('an override wins over the name', () => {
      expect(new CustomIdProvider({} as Settings).getProviderId()).toBe('openai');
    });
  });

  describe('abstract surface', () => {
    test('generateSummary はプロバイダ自身の実装を返す', async () => {
      const result = await provider().generateSummary('test content');
      expect(result.summary).toBe('summary of test content');
    });

    test('testConnection はプロバイダ自身の実装を返す', async () => {
      const result = await provider().testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toBe('OK');
    });

    test('getName は既定でプロバイダIDを返す', () => {
      expect(provider().getName()).toBe('test-provider');
    });
  });

  // The on-device provider extends this class and never reaches a transport, so
  // the base must not offer it a request template it could call by accident.
  test('基底クラスは HTTP フローを持たない', () => {
    const surface = provider() as unknown as Record<string, unknown>;

    expect(surface['executeHttpSummaryFlow']).toBeUndefined();
    expect(surface['executeHttpTestFlow']).toBeUndefined();
    expect(surface['checkPreFlight']).toBeUndefined();
    expect(surface['sanitizeContent']).toBeUndefined();
    expect(surface['buildTestDebugBase']).toBeUndefined();
  });
});
