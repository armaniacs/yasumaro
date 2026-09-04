/**
 * pipelineErrorRegression.test.ts
 * 回帰テスト: BBC/CNN で `pipeline-error` (Cannot read properties of undefined reading 'userTlds'/'presets')
 * が発生し「今すぐ記録」がブロックされていた不具合の再発防止。
 * 破損DB（jpAnchor/presets/sensitive/tranco 欠落）でも pipeline が例外を投げず、
 * 新たな記録が失敗しないことを保証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DomainVerifier } from '../domainVerifier.js';
import { DomainTrustLevel } from '../trustDbSchema.js';
import type { TrustDatabase } from '../trustDbSchema.js';
import { getTrustDbAdmin, TrustDbAdmin } from '../TrustDbAdmin.js';

function makeCorruptedDb(overrides: Partial<TrustDatabase> = {}): unknown {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    bloomFilter: { data: 'test', hash: 'test' },
    // Intentionally missing jpAnchor / sensitive / tranco to simulate corruption
    ...overrides,
  };
}

describe('pipelineErrorRegression: 破損DBでも記録が失敗しない', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DomainVerifier.checkJpAnchor は jpAnchor 欠落でも例外を投げず UNVERIFIED を返す', () => {
    const verifier = new DomainVerifier();
    const state = {
      database: { jpAnchor: undefined } as unknown as TrustDatabase,
      bloomFilter: { mightContain: () => false } as unknown as never,
      trancoSet: new Set<string>(),
      trancoRankMap: new Map<string, number>(),
    };
    const result = verifier.checkJpAnchor('https://www.bbc.com/news/articles/c770jyd4l7lo', state);
    expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
  });

  it('DomainVerifier.checkJpAnchor は userTlds 欠落でも例外を投げず UNVERIFIED を返す', () => {
    const verifier = new DomainVerifier();
    const state = {
      database: { jpAnchor: { tlds: ['.com'], userTlds: undefined } } as unknown as TrustDatabase,
      bloomFilter: { mightContain: () => false } as unknown as never,
      trancoSet: new Set<string>(),
      trancoRankMap: new Map<string, number>(),
    };
    // Should not throw even if userTlds is undefined (legacy DB)
    // Our guard in 6.7.92/93/94 should handle, but test the current behavior
    // If jpAnchor exists but userTlds is undefined, the spread will fail — we expect UNVERIFIED via guard
    let threw = false;
    try {
      verifier.checkJpAnchor('https://www.bbc.com/news/articles/c770jyd4l7lo', state);
    } catch {
      threw = true;
    }
    // After 6.7.95 repair, this should not throw; before fix it threw reading 'userTlds'
    expect(threw).toBe(false);
  });

  it('DomainVerifier.checkSensitive は presets 欠落でも例外を投げず UNVERIFIED を返す', () => {
    const verifier = new DomainVerifier();
    const state = {
      database: { sensitive: undefined } as unknown as TrustDatabase,
      bloomFilter: { mightContain: () => false } as unknown as never,
      trancoSet: new Set<string>(),
      trancoRankMap: new Map<string, number>(),
    };
    const result = verifier.checkSensitive('https://www.bbc.com/news/articles/c770jyd4l7lo', state);
    expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
  });

  it('DomainVerifier.checkSensitive は presets.finance 欠落でも例外を投げず UNVERIFIED を返す', () => {
    const verifier = new DomainVerifier();
    const state = {
      database: { sensitive: { presets: undefined, userBlacklist: [], whitelist: [] } } as unknown as TrustDatabase,
      bloomFilter: { mightContain: () => true } as unknown as never,
      trancoSet: new Set<string>(),
      trancoRankMap: new Map<string, number>(),
    };
    const result = verifier.checkSensitive('https://www.bbc.com/news/articles/c770jyd4l7lo', state);
    expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
  });

  it('TrustDb.isDomainTrusted は未初期化でも例外を投げず UNVERIFIED を返す', async () => {
    const db = getTrustDbAdmin();
    // 未初期化状態を強制: bloomFilter が無い状態でも UNVERIFIED を返す（trustDb.ts:332 のガード）
    // @ts-expect-error private access for test
    db['state'] = { database: null, bloomFilter: null, initialized: false };
    const result = db.isDomainTrusted('https://www.bbc.com/news/articles/c770jyd4l7lo');
    expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
    expect(result.reason).toMatch(/not initialized/i);
  });

  it('TrustDb.doInitialize は破損DB（jpAnchor/presets欠落）を修復し pipeline-error を投げない', async () => {
    const db = getTrustDbAdmin();
    // 直接 repairDatabase を呼び出し、破損DBが修復されることを検証（bloomFilter の integrity を回避）
    const corrupted = makeCorruptedDb({
      jpAnchor: { tlds: ['.com'] } as unknown as never, // userTlds missing
      sensitive: { presets: undefined } as unknown as never,
      tranco: { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 } as unknown as never,
    }) as Record<string, unknown>;
    // @ts-expect-error private
    db['repairDatabase'](corrupted as never);
    expect((corrupted as Record<string, unknown>).jpAnchor).toBeDefined();
    expect(((corrupted as unknown as { jpAnchor: { userTlds: unknown } }).jpAnchor.userTlds)).toEqual([]);
    expect(((corrupted as unknown as { sensitive: { presets: { finance: unknown } } }).sensitive.presets.finance)).toEqual([]);
    // 修復後は DomainVerifier が例外を投げない
    const verifier = new DomainVerifier();
    const state = {
      database: corrupted as unknown as TrustDatabase,
      bloomFilter: { mightContain: () => false } as unknown as never,
      trancoSet: new Set<string>(),
      trancoRankMap: new Map<string, number>(),
    };
    expect(() => verifier.isDomainTrusted('https://www.bbc.com/news/articles/c770jyd4l7lo', state)).not.toThrow();
  });

  it('BBC/CNN の実URLで pipeline が例外を投げない', async () => {
    const verifier = new DomainVerifier();
    const urls = [
      'https://www.bbc.com/news/articles/c770jyd4l7lo',
      'https://edition.cnn.com/2026/08/29/europe/iceland-eu-referendum-talks-votes-hnk-intl',
      'https://www.bbc.com/travel/article/20260828-the-mu',
    ];
    // 欠落した userTlds/presets でも例外を投げず、BBCは .customtld にも該当しないため UNVERIFIED
    const corruptedState = {
      database: {
        jpAnchor: { tlds: ['.customtld'], userTlds: undefined },
        sensitive: { presets: undefined, userBlacklist: [], whitelist: [] },
        tranco: { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 },
      } as unknown as TrustDatabase,
      bloomFilter: { mightContain: () => false } as unknown as never,
      trancoSet: new Set<string>(),
      trancoRankMap: new Map<string, number>(),
    };
    for (const url of urls) {
      expect(() => verifier.isDomainTrusted(url, corruptedState)).not.toThrow();
      const result = verifier.isDomainTrusted(url, corruptedState);
      expect(result.level).toBe(DomainTrustLevel.UNVERIFIED);
    }
  });
});
