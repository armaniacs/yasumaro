/**
 * trustDbRemovePersistence.test.ts
 * PBI 2026-10-18-06: 信頼DB remove 操作の CAS merge（操作種別考慮）を pin する。
 *
 * 監査 fingerprint: trust-db-save:merge-union-reverts-user-removals
 * populated trust_db を seed し、実 withOptimisticLock（共有
 * chrome.storage.local モック上）を通して「書き戻し後の trust_db」を読み戻す。
 * 旧 merge（純粋 union）では削除済みドメインが version bump 付きで復活するため、
 * storage 読み戻し assert は修正前に赤になる。
 *
 * 既存 trustDb.test.ts の削除テスト（chrome.storage.local.get を {} に固定）
 * は base が空で union 再追加が発生しないため本バグを検出できない。既存テストは
 * 改変せず、populated base を返す本テストを別ファイルで pin する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TrustDatabase } from '../trustDbSchema.js';
import { DomainTrustLevel } from '../trustDbSchema.js';
import {
  getTrustDbAdmin,
  TrustDbAdmin,
  _resetTrustDbAdminForTest,
  TRUST_DB_STORAGE_KEY,
} from '../TrustDbAdmin.js';
import { TrustDbKernel } from '../TrustDbKernel.js';
import { DomainVerifier } from '../domainVerifier.js';
import { bloomFilterFromDomains } from '../bloomFilter.js';

vi.mock('../../logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logDebug: 'fn',
    logInfo: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    ErrorCode: {},
  }),
);
vi.mock('../../logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logDebug: 'fn',
    logInfo: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    ErrorCode: {},
  }),
);
vi.mock('../../logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logDebug: 'fn',
    logInfo: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    ErrorCode: {},
  }),
);

// CAS 競合リトライの待ちを実時間にしない（production の backoff を注入で潰す）
const NO_WAIT = async (): Promise<void> => {};

function buildSeed(overrides?: {
  whitelist?: string[];
  userBlacklist?: string[];
  userTlds?: string[];
}): TrustDatabase {
  const whitelist = overrides?.whitelist ?? [];
  const userBlacklist = overrides?.userBlacklist ?? [];
  const userTlds = overrides?.userTlds ?? [];
  return {
    version: '1.0.0',
    lastUpdated: '2026-10-18T00:00:00.000Z',
    tranco: { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 },
    jpAnchor: { tlds: ['.go.jp'], userTlds },
    sensitive: {
      presets: { finance: ['finance-preset.example'], gaming: [], sns: [] },
      userBlacklist,
      whitelist,
    },
    // bloom は presets 由来のみ。削除対象ドメインを bloom に入れないことで
    // whitelist / userBlacklist の完全一致経路だけを判定させる。
    bloomFilter: bloomFilterFromDomains(['finance-preset.example']).toData(),
  };
}

async function seedStorage(db: TrustDatabase): Promise<void> {
  await chrome.storage.local.set({ [TRUST_DB_STORAGE_KEY]: db });
}

async function readStoredTrustDb(): Promise<TrustDatabase> {
  const result = await chrome.storage.local.get(TRUST_DB_STORAGE_KEY);
  return result[TRUST_DB_STORAGE_KEY] as TrustDatabase;
}

function freshAdmin(): TrustDbAdmin {
  _resetTrustDbAdminForTest();
  TrustDbAdmin.initPromise = null;
  return getTrustDbAdmin();
}

beforeEach(() => {
  _resetTrustDbAdminForTest();
  TrustDbAdmin.initPromise = null;
});

describe('trustDb remove persistence with populated trust_db (PBI 2026-10-18-06)', () => {
  it('Scenario 1: removeFromWhitelist の削除は書き戻し後の trust_db に残らず再起動後も復活しない', async () => {
    await seedStorage(buildSeed({ whitelist: ['secret.example.com', 'keep.example.com'] }));
    const db = freshAdmin();
    await db.initialize();

    const result = await db.removeFromWhitelist('secret.example.com');
    expect(result.success).toBe(true);

    // 書き戻し後の trust_db に削除済みドメインは存在しない
    const stored = await readStoredTrustDb();
    expect(stored.sensitive.whitelist).not.toContain('secret.example.com');
    expect(stored.sensitive.whitelist).toContain('keep.example.com');

    // UI (in-memory) の表示とストレージの実体が一致する
    expect(db.getWhitelist()).toEqual(stored.sensitive.whitelist);

    // ダッシュボード再オープン相当: kernel を再初期化しても復活しない
    const reopened = freshAdmin();
    await reopened.initialize();
    expect(reopened.getWhitelist()).not.toContain('secret.example.com');
  });

  it('Scenario 2: removeSensitiveDomain の削除は書き戻し後の userBlacklist に残らない', async () => {
    await seedStorage(buildSeed({ userBlacklist: ['blocked.example.com', 'keep.example.com'] }));
    const db = freshAdmin();
    await db.initialize();

    const result = await db.removeSensitiveDomain('blocked.example.com');
    expect(result.success).toBe(true);

    const stored = await readStoredTrustDb();
    expect(stored.sensitive.userBlacklist).not.toContain('blocked.example.com');
    expect(stored.sensitive.userBlacklist).toContain('keep.example.com');
    expect(db.getDatabase()).toEqual(stored);
  });

  it('Scenario 2: removeUserTld の削除は書き戻し後の jpAnchor.userTlds に残らない', async () => {
    await seedStorage(buildSeed({ userTlds: ['.internal', '.keep.jp'] }));
    const db = freshAdmin();
    await db.initialize();

    const result = await db.removeUserTld('.internal');
    expect(result.success).toBe(true);

    const stored = await readStoredTrustDb();
    expect(stored.jpAnchor.userTlds).not.toContain('.internal');
    expect(stored.jpAnchor.userTlds).toContain('.keep.jp');
    expect(db.getDatabase()).toEqual(stored);
  });

  it('Scenario 2: removeJpAnchorTld の削除は書き戻し後の jpAnchor.userTlds に残らない', async () => {
    await seedStorage(buildSeed({ userTlds: ['.custom.example', '.keep.jp'] }));
    const db = freshAdmin();
    await db.initialize();

    const result = await db.removeJpAnchorTld('.custom.example');
    expect(result.success).toBe(true);

    const stored = await readStoredTrustDb();
    expect(stored.jpAnchor.userTlds).not.toContain('.custom.example');
    expect(stored.jpAnchor.userTlds).toContain('.keep.jp');
    expect(db.getDatabase()).toEqual(stored);
  });

  it('in-memory database は CAS merge の戻り値（merged）に寄せられる', async () => {
    await seedStorage(buildSeed({ whitelist: ['secret.example.com', 'keep.example.com'] }));
    const db = freshAdmin();
    await db.initialize();

    await db.removeFromWhitelist('secret.example.com');

    // 旧実装は in-memory state.database を merge 戻り値と結び付けないため、
    // in-memory とストレージが乖離する。修正後は同一内容になる。
    const stored = await readStoredTrustDb();
    expect(db.getDatabase()).toEqual(stored);
    expect(db.getWhitelist()).toEqual(stored.sensitive.whitelist);
  });

  it('Scenario 5: 削除済みドメインへの blacklist 追加が whitelist 判定で打ち消されない', async () => {
    await seedStorage(buildSeed({ whitelist: ['privacy.example.com'] }));
    const db = freshAdmin();
    await db.initialize();

    await db.removeFromWhitelist('privacy.example.com');
    const addResult = await db.addSensitiveDomain('privacy.example.com');
    expect(addResult.success).toBe(true);

    // 記録パイプライン相当: ストレージから kernel を再初期化して判定する
    const fresh = freshAdmin();
    await fresh.initialize();
    const verdict = fresh.isDomainTrusted('privacy.example.com');

    expect(verdict.level).toBe(DomainTrustLevel.SENSITIVE);
    expect(verdict.source).not.toBe('whitelist');
    expect(verdict.source).toBe('user-blacklist');

    // checkSensitive（whitelist 優先ステップ、domainVerifier.ts:130 相当）:
    // 旧 merge で復活した whitelist エントリがユーザー blacklist を上書きしない
    const verifier = new DomainVerifier();
    const database = fresh.getDatabase();
    if (!database) throw new Error('TrustDb not initialized');
    const bloomFilter = fresh.getPolicy().getBloomFilter();
    if (!bloomFilter) throw new Error('TrustDb bloom filter not initialized');
    const sensitiveResult = verifier.checkSensitive('privacy.example.com', {
      database,
      bloomFilter,
      trancoSet: new Set<string>(),
      trancoRankMap: new Map<string, number>(),
    });
    expect(sensitiveResult.level).toBe(DomainTrustLevel.SENSITIVE);
    expect(sensitiveResult.source).toBe('user-blacklist');
  });
});

describe('trustDb concurrent writers through the real CAS (PBI 2026-10-18-06)', () => {
  it('Scenario 3: 2 kernel の並行追加は互いの delta を残す（既存 lock 契約が壊れない）', async () => {
    await seedStorage(buildSeed({ whitelist: ['seed.example.com'] }));
    const kernelA = new TrustDbKernel({ casRetrySleep: NO_WAIT });
    const kernelB = new TrustDbKernel({ casRetrySleep: NO_WAIT });
    await kernelA.initialize();
    await kernelB.initialize();

    const [resA, resB] = await Promise.all([
      kernelA.addToWhitelist('a.example.com'),
      kernelB.addToWhitelist('b.example.com'),
    ]);
    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);

    const stored = await readStoredTrustDb();
    expect(stored.sensitive.whitelist).toEqual(
      expect.arrayContaining(['seed.example.com', 'a.example.com', 'b.example.com'])
    );
  });

  it('Scenario 4: 削除と追加が競合しても削除済みドメインは復活しない', async () => {
    await seedStorage(buildSeed({ whitelist: ['x.example.com', 'base.example.com'] }));
    const remover = new TrustDbKernel({ casRetrySleep: NO_WAIT });
    const adder = new TrustDbKernel({ casRetrySleep: NO_WAIT });
    await remover.initialize();
    await adder.initialize();

    const [resRemove, resAdd] = await Promise.all([
      remover.removeFromWhitelist('x.example.com'),
      adder.addToWhitelist('y.example.com'),
    ]);
    expect(resRemove.success).toBe(true);
    expect(resAdd.success).toBe(true);

    const stored = await readStoredTrustDb();
    expect(stored.sensitive.whitelist).not.toContain('x.example.com');
    expect(stored.sensitive.whitelist).toContain('y.example.com');
    expect(stored.sensitive.whitelist).toContain('base.example.com');
  });
});
