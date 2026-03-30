/**
 * trustDbSchema.test.ts
 * trustDbSchema.tsのテスト
 * 【テスト対象】: src/utils/trustDb/trustDbSchema.ts
 */
import { describe, test, expect } from '@jest/globals';
import { DomainTrustLevel, type TrustResult, type TrustDatabase, type SafetyConfig } from '../trustDbSchema.js';

describe('trustDbSchema', () => {
  describe('DomainTrustLevel enum', () => {
    test('TRUSTED は "trusted"', () => {
      expect(DomainTrustLevel.TRUSTED).toBe('trusted');
    });

    test('SENSITIVE は "sensitive"', () => {
      expect(DomainTrustLevel.SENSITIVE).toBe('sensitive');
    });

    test('UNVERIFIED は "unverified"', () => {
      expect(DomainTrustLevel.UNVERIFIED).toBe('unverified');
    });

    test('LOCKED は "locked"', () => {
      expect(DomainTrustLevel.LOCKED).toBe('locked');
    });

    test('全メンバが定義されている', () => {
      const values = Object.values(DomainTrustLevel);
      expect(values).toHaveLength(4);
      expect(values).toContain('trusted');
      expect(values).toContain('sensitive');
      expect(values).toContain('unverified');
      expect(values).toContain('locked');
    });
  });

  describe('TrustResult 型の構造確認', () => {
    test('全フィールド付きのTrustResultが代入可能', () => {
      const result: TrustResult = {
        level: DomainTrustLevel.TRUSTED,
        source: 'tranco',
        reason: 'Top 1000 domain',
        category: 'finance',
      };
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
      expect(result.source).toBe('tranco');
    });

    test('最小フィールドのTrustResultが代入可能', () => {
      const result: TrustResult = {
        level: DomainTrustLevel.UNVERIFIED,
        source: 'unknown',
      };
      expect(result.reason).toBeUndefined();
      expect(result.category).toBeUndefined();
    });
  });

  describe('TrustDatabase 型の構造確認', () => {
    test('完全なTrustDatabaseが代入可能', () => {
      const db: TrustDatabase = {
        version: '1.0.0',
        lastUpdated: '2026-01-01T00:00:00Z',
        tranco: { tier: 'top1k', domains: ['google.com'], count: 1, sizeBytes: 100 },
        jpAnchor: { tlds: ['.jp'], userTlds: [] },
        sensitive: { presets: { finance: [], gaming: [], sns: [] }, userBlacklist: [], whitelist: [] },
        bloomFilter: { data: '', hashCount: 3, bitCount: 1024, expectedDomainCount: 1000, hash: '' },
      };
      expect(db.version).toBe('1.0.0');
    });
  });

  describe('SafetyConfig 型の構造確認', () => {
    test('SafetyConfigが代入可能', () => {
      const config: SafetyConfig = {
        mode: 'balanced',
        trancoTier: 'top10k',
        alerts: { alertFinance: true, alertSensitive: false, alertUnverified: true },
      };
      expect(config.mode).toBe('balanced');
    });
  });
});
