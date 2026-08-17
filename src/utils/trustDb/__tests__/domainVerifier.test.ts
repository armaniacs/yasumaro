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
    test('プリセット TLD で一致すれば TRUSTED', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.checkJpAnchor('example.go.jp', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
      expect(result.source).toBe('jp-anchor');
    });

    test('ユーザー追加 TLD でも一致する', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({ jpAnchor: { tlds: [], userTlds: ['.custom'] } });
      const state = makeState({ database });
      const result = verifier.checkJpAnchor('site.custom', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
    });

    test('一致しなければ UNVERIFIED', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.checkJpAnchor('example.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
    });
  });

  describe('checkSensitive', () => {
    test('ホワイトリストは TRUSTED を返す', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({
        sensitive: { presets: { finance: [], gaming: [], sns: [] }, userBlacklist: [], whitelist: ['allowed.com'] }
      });
      const state = makeState({ database });
      const result = verifier.checkSensitive('allowed.com', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
      expect(result.source).toBe('whitelist');
    });

    test('ユーザーブラックリストは SENSITIVE を返す', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({
        sensitive: { presets: { finance: [], gaming: [], sns: [] }, userBlacklist: ['bad.com'], whitelist: [] }
      });
      const state = makeState({ database });
      const result = verifier.checkSensitive('bad.com', state);
      expect(result.level).toBe(DomainTrustLevel.SENSITIVE);
      expect(result.source).toBe('user-blacklist');
    });

    test('プリセットカテゴリと bloom filter が一致すれば SENSITIVE', () => {
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

    test('bloom filter が一致しなければ UNVERIFIED', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.checkSensitive('unknown.example', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
    });

    test('bloom filter 偽陽性の場合 UNVERIFIED を返す', () => {
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
    test('Tranco リストが空なら UNVERIFIED', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.checkTranco('example.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
      expect(result.reason).toBe('Tranco list is empty');
    });

    test('完全一致で TRUSTED（rank 情報付き）', () => {
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

    test('サブドメインを除去して一致すれば TRUSTED', () => {
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

    test('一致しなければ UNVERIFIED', () => {
      const verifier = new DomainVerifier();
      const database = makeDatabase({ tranco: { tier: 'top10k', domains: ['cnn.com'], count: 1, sizeBytes: 7 } });
      const bloomFilter = bloomFilterFromDomains(['cnn.com']);
      const state = makeState({ database, bloomFilter, trancoSet: new Set(['cnn.com']) });
      const result = verifier.checkTranco('unrelated.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
    });
  });

  describe('isDomainTrusted (3-step composition)', () => {
    test('URL 形式ならホスト名を抽出して判定する', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.isDomainTrusted('https://example.go.jp/page', state);
      expect(result.level).toBe(DomainTrustLevel.TRUSTED);
      expect(result.source).toBe('jp-anchor');
    });

    test('どのステップにも一致しなければ UNVERIFIED', () => {
      const verifier = new DomainVerifier();
      const state = makeState();
      const result = verifier.isDomainTrusted('example.com', state);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
      expect(result.reason).toBe('Domain not in any trusted list');
    });
  });
});
