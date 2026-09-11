import { describe, test, expect } from 'vitest';
import { DomainVerifier, type DomainVerifierState } from '../domainVerifier.js';
import { DomainTrustLevel, type TrustDatabase } from '../trustDbSchema.js';
import { bloomFilterFromDomains } from '../bloomFilter.js';

function makeDatabase(overrides: Partial<TrustDatabase> = {}): TrustDatabase {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    tranco: { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 },
    jpAnchor: { tlds: ['.go.jp', '.ac.jp'], userTlds: [] },
    sensitive: {
      presets: { finance: [], gaming: [], sns: [] },
      userBlacklist: [],
      whitelist: []
    },
    bloomFilter: {
      data: '',
      hashCount: 1,
      bitCount: 1,
      expectedDomainCount: 0,
      hash: ''
    },
    ...overrides
  };
}

function makeState(overrides: Partial<DomainVerifierState> = {}): DomainVerifierState {
  const database = overrides.database ?? makeDatabase();
  const bloomFilter = overrides.bloomFilter ?? bloomFilterFromDomains([]);
  return {
    database,
    bloomFilter,
    trancoSet: overrides.trancoSet ?? new Set(),
    trancoRankMap: overrides.trancoRankMap ?? new Map(),
  };
}

describe('DomainVerifier', () => {
  describe('checkJpAnchor', () => {
    test('returns TRUSTED when a preset TLD matches', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.checkJpAnchor('example.go.jp', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
      expect(result.source).toBe('jp-anchor');
    });

    test('matches user-added TLDs', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({ jpAnchor: { tlds: [], userTlds: ['.custom'] } });
      const state = makeState({ database });
      const result = verifier.checkJpAnchor('site.custom', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
    });

    test('returns UNVERIFIED when nothing matches', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.checkJpAnchor('example.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
    });
  });

  describe('checkSensitive', () => {
    test('returns TRUSTED for whitelisted domains', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({
        sensitive: { presets: { finance: [], gaming: [], sns: [] }, userBlacklist: [], whitelist: ['allowed.com'] }
      });
      const state = makeState({ database });
      const result = verifier.checkSensitive('allowed.com', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
      expect(result.source).toBe('whitelist');
    });

    test('returns SENSITIVE for user-blacklisted domains', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({
        sensitive: { presets: { finance: [], gaming: [], sns: [] }, userBlacklist: ['bad.com'], whitelist: [] }
      });
      const state = makeState({ database });
      const result = verifier.checkSensitive('bad.com', state);
      expect(result.level).toBe(DomainTrustLevel.SENSITIVE);
      expect(result.source).toBe('user-blacklist');
    });

    test('returns SENSITIVE when preset category and bloom filter match', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({
        sensitive: {
          presets: { finance: ['bank.example'], gaming: [], sns: [] },
          userBlacklist: [],
          whitelist: []
        }
      });
      const bloomFilter = bloomFilterFromDomains(['bank.example']);
      const state = makeState({ database, bloomFilter });
      const result = verifier.checkSensitive('bank.example', state);
      expect(result.level).toBe(DomainTrustLevel.SENSITIVE);
      expect(result.category).toBe('finance');
    });

    test('returns UNVERIFIED when bloom filter does not match', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.checkSensitive('unknown.example', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
    });

    test('returns UNVERIFIED on bloom filter false positive', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase();
      const bloomFilter = { mightContain: () => true, toData: () => database.bloomFilter } as any;
      const state = makeState({ database, bloomFilter });
      const result = verifier.checkSensitive('false-positive.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
      expect(result.reason).toBe('Bloom filter false positive');
    });
  });

  describe('checkTranco', () => {
    test('returns UNVERIFIED when Tranco list is empty', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.checkTranco('example.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
      expect(result.reason).toBe('Tranco list is empty');
    });

    test('returns TRUSTED with rank info on exact match', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({ tranco: { tier: 'top10k', domains: ['cnn.com'], count: 1, sizeBytes: 7 } });
      const bloomFilter = bloomFilterFromDomains(['cnn.com']);
      const state = makeState({
        database,
        bloomFilter,
        trancoSet: new Set(['cnn.com']),
        trancoRankMap: new Map([['cnn.com', 0]]),
      });
      const result = verifier.checkTranco('cnn.com', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
      expect(result.source).toBe('tranco');
      expect(result.reason).toContain('rank 1');
    });

    test('returns TRUSTED when stripped subdomain matches', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({ tranco: { tier: 'top10k', domains: ['cnn.com'], count: 1, sizeBytes: 7 } });
      const bloomFilter = bloomFilterFromDomains(['cnn.com']);
      const state = makeState({
        database,
        bloomFilter,
        trancoSet: new Set(['cnn.com']),
        trancoRankMap: new Map([['cnn.com', 0]]),
      });
      const result = verifier.checkTranco('edition.cnn.com', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
    });

    test('returns UNVERIFIED when nothing matches', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({ tranco: { tier: 'top10k', domains: ['cnn.com'], count: 1, sizeBytes: 7 } });
      const bloomFilter = bloomFilterFromDomains(['cnn.com']);
      const state = makeState({ database, bloomFilter, trancoSet: new Set(['cnn.com']) });
      const result = verifier.checkTranco('unrelated.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
    });
  });

  describe('isDomainTrusted (3-step composition)', () => {
    test('extracts hostname from URL before judging', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.isDomainTrusted('https://example.go.jp/page', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
      expect(result.source).toBe('jp-anchor');
    });

    test('returns UNVERIFIED when no step matches', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.isDomainTrusted('example.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
      expect(result.reason).toBe('Domain not in any trusted list');
    });
  });
});
