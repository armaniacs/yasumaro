/**
 * presets.test.ts
 * Unit tests for Trust Database preset configurations
 */

import { describe, it, expect } from 'vitest';
import {
  JP_ANCHOR_TLDS,
  SENSITIVE_DOMAINS_PRESETS,
  DEFAULT_TRANCO_TIER,
  createDefaultTrustDb,
  createDefaultJpAnchorConfig,
  createDefaultSensitiveConfig,
  createEmptyBloomFilterData,
  getAllPresetDomains,
  PRESET_DOMAIN_COUNT,
} from '../presets.js';

describe('presets', () => {
  describe('JP_ANCHOR_TLDS', () => {
    it('should contain Japanese government TLDs', () => {
      expect(JP_ANCHOR_TLDS).toContain('.go.jp');
      expect(JP_ANCHOR_TLDS).toContain('.ac.jp');
      expect(JP_ANCHOR_TLDS).toContain('.lg.jp');
    });

    it('should be immutable in consumers (spread creates copy)', () => {
      const copy = [...JP_ANCHOR_TLDS];
      copy.push('.co.jp');
      expect(JP_ANCHOR_TLDS).not.toContain('.co.jp');
    });
  });

  describe('SENSITIVE_DOMAINS_PRESETS', () => {
    it('should have finance, gaming, and sns categories', () => {
      expect(SENSITIVE_DOMAINS_PRESETS.finance.length).toBeGreaterThan(0);
      expect(SENSITIVE_DOMAINS_PRESETS.gaming.length).toBeGreaterThan(0);
      expect(SENSITIVE_DOMAINS_PRESETS.sns.length).toBeGreaterThan(0);
    });

    it('should contain major Japanese banks in finance', () => {
      const finance = SENSITIVE_DOMAINS_PRESETS.finance;
      expect(finance).toContain('mizuhobank.co.jp');
      expect(finance).toContain('ufj.co.jp');
      expect(finance).toContain('smbc.co.jp');
    });

    it('should contain major gaming companies', () => {
      const gaming = SENSITIVE_DOMAINS_PRESETS.gaming;
      expect(gaming).toContain('nintendo.com');
      expect(gaming).toContain('square-enix.com');
      expect(gaming).toContain('capcom.co.jp');
    });

    it('should contain major SNS platforms', () => {
      const sns = SENSITIVE_DOMAINS_PRESETS.sns;
      expect(sns).toContain('twitter.com');
      expect(sns).toContain('x.com');
      expect(sns).toContain('instagram.com');
      expect(sns).toContain('facebook.com');
    });
  });

  describe('DEFAULT_TRANCO_TIER', () => {
    it('should default to top10k', () => {
      expect(DEFAULT_TRANCO_TIER).toBe('top10k');
    });
  });

  describe('createDefaultTrustDb', () => {
    it('should create a valid TrustDatabase structure', () => {
      const db = createDefaultTrustDb();

      expect(db.version).toBe('1.0.0');
      expect(db.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect(db.tranco.tier).toBe('top10k');
      expect(db.tranco.domains).toEqual([]);
      expect(db.tranco.count).toBe(0);

      expect(db.jpAnchor.tlds).toEqual(JP_ANCHOR_TLDS);
      expect(db.jpAnchor.userTlds).toEqual([]);

      expect(db.sensitive.presets.finance.length).toBeGreaterThan(0);
      expect(db.sensitive.userBlacklist).toEqual([]);
      expect(db.sensitive.whitelist).toEqual([]);

      expect(db.bloomFilter.data).toBe('');
      expect(db.bloomFilter.hashCount).toBe(0);
    });

    it('should create independent copies (no shared references)', () => {
      const db1 = createDefaultTrustDb();
      const db2 = createDefaultTrustDb();

      db1.jpAnchor.userTlds.push('.example.jp');
      expect(db2.jpAnchor.userTlds).toEqual([]);

      db1.sensitive.userBlacklist.push('example.com');
      expect(db2.sensitive.userBlacklist).toEqual([]);
    });
  });

  describe('createDefaultJpAnchorConfig', () => {
    it('should create config with default TLDs', () => {
      const config = createDefaultJpAnchorConfig();
      expect(config.tlds).toEqual(JP_ANCHOR_TLDS);
      expect(config.userTlds).toEqual([]);
    });

    it('should create independent copy', () => {
      const config1 = createDefaultJpAnchorConfig();
      const config2 = createDefaultJpAnchorConfig();

      config1.userTlds.push('.test.jp');
      expect(config2.userTlds).toEqual([]);
    });
  });

  describe('createDefaultSensitiveConfig', () => {
    it('should create config with all preset categories', () => {
      const config = createDefaultSensitiveConfig();
      expect(config.presets.finance.length).toBeGreaterThan(0);
      expect(config.presets.gaming.length).toBeGreaterThan(0);
      expect(config.presets.sns.length).toBeGreaterThan(0);
      expect(config.userBlacklist).toEqual([]);
      expect(config.whitelist).toEqual([]);
    });

    it('should create independent copy', () => {
      const config1 = createDefaultSensitiveConfig();
      const config2 = createDefaultSensitiveConfig();

      config1.userBlacklist.push('evil.com');
      expect(config2.userBlacklist).toEqual([]);
    });
  });

  describe('createEmptyBloomFilterData', () => {
    it('should create empty bloom filter structure', () => {
      const bf = createEmptyBloomFilterData();
      expect(bf.data).toBe('');
      expect(bf.hashCount).toBe(0);
      expect(bf.bitCount).toBe(0);
      expect(bf.expectedDomainCount).toBe(0);
      expect(bf.hash).toBe('');
    });
  });

  describe('getAllPresetDomains', () => {
    it('should return all domains from all categories', () => {
      const all = getAllPresetDomains();
      const expectedCount =
        SENSITIVE_DOMAINS_PRESETS.finance.length +
        SENSITIVE_DOMAINS_PRESETS.gaming.length +
        SENSITIVE_DOMAINS_PRESETS.sns.length;

      expect(all.length).toBe(expectedCount);
      expect(all).toContain('mizuhobank.co.jp');
      expect(all).toContain('nintendo.com');
      expect(all).toContain('twitter.com');
    });
  });

  describe('PRESET_DOMAIN_COUNT', () => {
    it('should match actual preset domain count', () => {
      expect(PRESET_DOMAIN_COUNT).toBe(getAllPresetDomains().length);
      expect(PRESET_DOMAIN_COUNT).toBeGreaterThan(0);
    });
  });
});
