// @vitest-environment wasm-quickjs-dom
/**
 * importLogsAiRepair.test.ts
 * PBI 2026-11-23-06: 閲覧ログ取込のAI修復提案。
 * Outside-In の起点となる E2E 相当: 失敗行の収集から修正案の差分提示、
 * 選択行の再検証と取込までを通しで確認する。AI 呼出しは境界で差替え、
 * 実時間待ちは使わない。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSqliteCall = vi.fn();
vi.mock('../dashboardSqliteService.js', () => ({
  sqliteClient: { call: (...args: unknown[]) => mockSqliteCall(...args) },
}));

vi.mock('../../utils/storage/encryptionSession.js', () => ({
  exportHmacSigner: {
    sign: vi.fn(async (payload: string) => `hmac(test-secret):${payload.length}:${payload.slice(0, 8)}`),
    verify: vi.fn(
      async (payload: string, sig: string) =>
        sig === `hmac(test-secret):${payload.length}:${payload.slice(0, 8)}`
    ),
  },
}));

const mockLogWarn = vi.hoisted(() => vi.fn(async () => {}));
const mockLogInfo = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../utils/logger/api.js', () => ({
  logError: vi.fn(async () => {}),
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
}));

const mockIsLocked = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../../utils/storage/authGuard.js', () => ({
  isLocked: mockIsLocked,
}));

vi.mock('../../utils/piiSanitizer.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../utils/piiSanitizer.js')>();
  return {
    ...orig,
    sanitizeRegex: async (text: string, options?: unknown) => {
      if (typeof text === 'string' && text.includes('__SANITIZE_FAIL__')) {
        throw new Error('sanitize fail (test double)');
      }
      return orig.sanitizeRegex(text, options as never);
    },
  };
});

const NOW = 1_700_000_000_000;

/** 失敗行を含む取込ファイル: url 欠落と created_at 欠落の混在。 */
function fileWithInvalidRows(): unknown {
  return {
    version: 1,
    logs: [
      { url: 'https://ok.test/', created_at: NOW, title: 'OK' },
      { pageTitle: 'no url', timestamp: NOW + 1 },
      { url: 'https://no-date.test/', title: 'no date' },
    ],
  };
}

/** PII を含む失敗行: 送信前に除去されることを確認する。 */
function piiRow(): unknown {
  return {
    version: 1,
    logs: [{ pageTitle: 'contact user@example.com today', timestamp: NOW }],
  };
}

describe('AI repair end-to-end (Outside-In起点)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLocked.mockResolvedValue(false);
    mockSqliteCall.mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
  });

  it('失敗行の収集から差分提示と選択行の再検証・取込までが完走する', async () => {
    const {
      collectAiRepairTargets,
      requestAiRepair,
      applyAiRepairProposals,
    } = await import('../importLogsAiRepair.js');

    const collected = collectAiRepairTargets(fileWithInvalidRows());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;
    expect(collected.targets).toHaveLength(2);
    expect(collected.targets[0]).toMatchObject({ index: 1, reason: 'url must be a non-empty string' });

    const sentTexts: string[] = [];
    const client = {
      repairRows: vi.fn(async (rows: Array<{ index: number; text: string }>) => {
        sentTexts.push(...rows.map((r) => r.text));
        return rows.map((r) => {
          const raw = JSON.parse(r.text) as Record<string, unknown>;
          return {
            index: r.index,
            text: JSON.stringify({ ...raw, url: `https://fixed-${r.index}.test/`, created_at: NOW }),
          };
        });
      }),
    };

    const requested = await requestAiRepair(collected.targets, { client });
    expect('error' in requested).toBe(false);
    if ('error' in requested) return;
    expect(requested.proposals).toHaveLength(2);
    expect(requested.failures).toHaveLength(0);
    // 差分として修正前後が示される。
    expect(requested.proposals[0]!.before).not.toBe(requested.proposals[0]!.after);
    expect(requested.proposals[0]!.before).toContain('no url');

    // 1行だけ選んで取り込む。
    const applied = await applyAiRepairProposals(requested.proposals, [requested.proposals[0]!.index]);
    expect('error' in applied).toBe(false);
    if ('error' in applied) return;
    expect(applied.applied).toBe(1);
    expect(applied.rejected).toHaveLength(0);
    expect(mockSqliteCall).toHaveBeenCalledTimes(1);
    expect(mockSqliteCall).toHaveBeenCalledWith(
      'import',
      expect.objectContaining({
        rows: [expect.objectContaining({ url: 'https://fixed-1.test/', created_at: NOW })],
      })
    );
    // 監査記録が残る (要求と適用)。
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.stringContaining('AI repair'),
      expect.anything(),
      expect.anything()
    );
    // 送信は失敗行のみ: 有効行の url は送られていない。
    expect(sentTexts.join('\n')).not.toContain('https://ok.test/');
  });

  it('収集と送信準備だけでは外部送信も取込も行わない (送信抑止)', async () => {
    const { collectAiRepairTargets, buildAiRepairPayload } = await import(
      '../importLogsAiRepair.js'
    );
    const client = { repairRows: vi.fn(async () => []) };

    const collected = collectAiRepairTargets(fileWithInvalidRows());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;
    await buildAiRepairPayload(collected.targets);

    expect(client.repairRows).not.toHaveBeenCalled();
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });
});

describe('送信抑止と上限 (統合)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLocked.mockResolvedValue(false);
    mockSqliteCall.mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
  });

  it('送信前にPII除去が行われる (既存 piiSanitizer を再利用)', async () => {
    const {
      collectAiRepairTargets,
      requestAiRepair,
    } = await import('../importLogsAiRepair.js');

    const collected = collectAiRepairTargets(piiRow());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;

    let sent = '';
    const client = {
      repairRows: vi.fn(async (rows: Array<{ index: number; text: string }>) => {
        sent = rows.map((r) => r.text).join('\n');
        return [];
      }),
    };
    await requestAiRepair(collected.targets, { client });

    expect(client.repairRows).toHaveBeenCalledTimes(1);
    expect(sent).not.toContain('user@example.com');
    expect(sent).toContain('[MASKED:email]');
  });

  it('件数と文字量に上限がある', async () => {
    const {
      collectAiRepairTargets,
      buildAiRepairPayload,
      MAX_AI_REPAIR_ROWS,
      MAX_AI_REPAIR_CHARS,
    } = await import('../importLogsAiRepair.js');
    expect(MAX_AI_REPAIR_ROWS).toBeLessThanOrEqual(20);
    expect(MAX_AI_REPAIR_CHARS).toBeLessThanOrEqual(8000);

    const logs = Array.from({ length: MAX_AI_REPAIR_ROWS + 5 }, (_, i) => ({
      pageTitle: `bad-${i} ${'x'.repeat(1000)}`,
      timestamp: NOW,
    }));
    const collected = collectAiRepairTargets({ logs });
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;

    // 収集時点で送信予算により打ち切られるため、ペイロード側に残余は見えない。
    expect(collected.targets.length).toBeLessThanOrEqual(MAX_AI_REPAIR_ROWS);
    expect(collected.targets.length).toBeLessThan(logs.length);

    const payload = await buildAiRepairPayload(collected.targets);
    expect(payload.items.length).toBeLessThanOrEqual(MAX_AI_REPAIR_ROWS);
    expect(payload.items.join('\n').length).toBeLessThanOrEqual(MAX_AI_REPAIR_CHARS);
  });

  it('AIクライアント未設定では何も送らない', async () => {
    const { collectAiRepairTargets, requestAiRepair } = await import(
      '../importLogsAiRepair.js'
    );

    const collected = collectAiRepairTargets(fileWithInvalidRows());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;

    const requested = await requestAiRepair(collected.targets, { client: null });
    expect(requested).toHaveProperty('error');
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });

  it('AIの応答が壊れていても取込まず理由を残す', async () => {
    const {
      collectAiRepairTargets,
      requestAiRepair,
      applyAiRepairProposals,
    } = await import('../importLogsAiRepair.js');

    const collected = collectAiRepairTargets(fileWithInvalidRows());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;

    const client = {
      repairRows: vi.fn(async (rows: Array<{ index: number; text: string }>) =>
        rows.map((r) => ({ index: r.index, text: 'not json at all' }))
      ),
    };
    const requested = await requestAiRepair(collected.targets, { client });
    expect('error' in requested).toBe(false);
    if ('error' in requested) return;
    expect(requested.proposals).toHaveLength(0);
    expect(requested.failures).toHaveLength(2);

    const applied = await applyAiRepairProposals(requested.proposals, []);
    expect(applied).toMatchObject({ applied: 0, rejected: [] });
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });
});

describe('施錠中の案内 (単体)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteCall.mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
  });

  it('鍵のロック中はAI修復を使えない案内になり送信も取込もしない', async () => {
    const { collectAiRepairTargets, requestAiRepair } = await import(
      '../importLogsAiRepair.js'
    );

    const collected = collectAiRepairTargets(fileWithInvalidRows());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;

    const client = { repairRows: vi.fn(async () => []) };
    const requested = await requestAiRepair(collected.targets, {
      client,
      lockCheck: async () => true,
    });

    expect(requested).toHaveProperty('error');
    expect(JSON.stringify(requested)).toMatch(/lock/i);
    expect(client.repairRows).not.toHaveBeenCalled();
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });

  it('既定では authGuard.isLocked を見る', async () => {
    mockIsLocked.mockResolvedValue(true);
    const { collectAiRepairTargets, requestAiRepair } = await import(
      '../importLogsAiRepair.js'
    );

    const collected = collectAiRepairTargets(fileWithInvalidRows());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;

    const requested = await requestAiRepair(collected.targets, {
      client: { repairRows: vi.fn(async () => []) },
    });

    expect(requested).toHaveProperty('error');
    expect(mockIsLocked).toHaveBeenCalled();
  });
});

describe('再検証 (統合)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLocked.mockResolvedValue(false);
    mockSqliteCall.mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
  });

  it('修正後も無効な行は取り込まず理由つきで除外する', async () => {
    const {
      collectAiRepairTargets,
      requestAiRepair,
      applyAiRepairProposals,
    } = await import('../importLogsAiRepair.js');

    const collected = collectAiRepairTargets(fileWithInvalidRows());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;

    const client = {
      repairRows: vi.fn(async (rows: Array<{ index: number; text: string }>) =>
        rows.map((r, i) =>
          i === 0
            ? { index: r.index, text: JSON.stringify({ url: 'https://repaired.test/', created_at: NOW }) }
            : { index: r.index, text: r.text }
        )
      ),
    };
    const requested = await requestAiRepair(collected.targets, { client });
    expect('error' in requested).toBe(false);
    if ('error' in requested) return;
    expect(requested.proposals).toHaveLength(2);

    const applied = await applyAiRepairProposals(
      requested.proposals,
      requested.proposals.map((p) => p.index)
    );
    expect('error' in applied).toBe(false);
    if ('error' in applied) return;
    expect(applied.applied).toBe(1);
    expect(applied.rejected).toHaveLength(1);
    expect(applied.rejected[0]).toMatchObject({ reason: 'created_at must be a finite number' });
    expect(mockSqliteCall).toHaveBeenCalledTimes(1);
  });

  it('選択外の行は取り込まない', async () => {
    const {
      collectAiRepairTargets,
      requestAiRepair,
      applyAiRepairProposals,
    } = await import('../importLogsAiRepair.js');

    const collected = collectAiRepairTargets(fileWithInvalidRows());
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;

    const client = {
      repairRows: vi.fn(async (rows: Array<{ index: number; text: string }>) =>
        rows.map((r) => ({
          index: r.index,
          text: JSON.stringify({ url: `https://fixed-${r.index}.test/`, created_at: NOW }),
        }))
      ),
    };
    const requested = await requestAiRepair(collected.targets, { client });
    expect('error' in requested).toBe(false);
    if ('error' in requested) return;

    const applied = await applyAiRepairProposals(requested.proposals, []);
    expect(applied).toMatchObject({ applied: 0 });
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });
});

describe('差分表示 (単体)', () => {
  it('修正前後を行単位の - / + で示す', async () => {
    const { formatAiRepairDiff } = await import('../importLogsAiRepair.js');

    const diff = formatAiRepairDiff({
      index: 1,
      reason: 'url must be a non-empty string',
      before: JSON.stringify({ title: 'A' }, null, 2),
      after: JSON.stringify({ title: 'A', url: 'https://fixed.test/' }, null, 2),
    });

    expect(diff).toContain('-');
    expect(diff).toContain('+');
    expect(diff).toContain('https://fixed.test/');
  });
});

describe('収集 (単体)', () => {
  it('有効行のみのファイルでは対象が空になる', async () => {
    const { collectAiRepairTargets } = await import('../importLogsAiRepair.js');

    const collected = collectAiRepairTargets({
      logs: [{ url: 'https://ok.test/', created_at: NOW }],
    });

    expect(collected).toEqual({ targets: [] });
  });

  it('行コンテナが無いファイルではエラーを返す', async () => {
    const { collectAiRepairTargets } = await import('../importLogsAiRepair.js');

    expect(collectAiRepairTargets({ version: 2 })).toHaveProperty('error');
  });
});

describe('収集の送信予算による早期打ち切り (指摘4の失敗試験)', () => {
  it('却下行が上限を超えても保持するのは送信予算分だけにする', async () => {
    const { collectAiRepairTargets, MAX_AI_REPAIR_ROWS } = await import(
      '../importLogsAiRepair.js'
    );

    const logs = Array.from({ length: MAX_AI_REPAIR_ROWS + 40 }, (_, i) => ({
      pageTitle: `bad-${i}`,
      timestamp: NOW,
    }));
    const collected = collectAiRepairTargets({ logs });
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;
    expect(collected.targets.length).toBeLessThanOrEqual(MAX_AI_REPAIR_ROWS);
  });

  it('文字量の予算を超えたら後続行を保持せず打ち切る', async () => {
    const { collectAiRepairTargets, MAX_AI_REPAIR_CHARS } = await import(
      '../importLogsAiRepair.js'
    );

    const logs = Array.from({ length: 30 }, (_, i) => ({
      pageTitle: `bad-${i} ${'x'.repeat(1000)}`,
      timestamp: NOW,
    }));
    const collected = collectAiRepairTargets({ logs });
    expect('error' in collected).toBe(false);
    if ('error' in collected) return;
    const used = collected.targets.reduce((sum, t, i) => sum + (i === 0 ? 0 : 1) + t.before.length, 0);
    expect(used).toBeLessThanOrEqual(MAX_AI_REPAIR_CHARS);
    expect(collected.targets.length).toBeLessThan(logs.length);
  });
});

describe('送信ペイロードの未送信数え上げ (指摘6の失敗試験)', () => {
  it('除去失敗と文字上限が重なっても二重計数しない', async () => {
    const { buildAiRepairPayload } = await import('../importLogsAiRepair.js');

    // JSON.parse に失敗し、フォールバックの sanitizeRegex も投げる行が除去対象。
    // (sanitizeJsonValue は文字列単位の失敗を握りつぶすため、有効 JSON では除去されない)
    const failing = '__SANITIZE_FAIL__ this is not json';
    // PII を含まず除去後も長さが安定する行で予算を埋める。2行で約5100字、
    // 3行目は約7650字になり文字上限に当たる。
    const big = (tag: string): string =>
      JSON.stringify({ pageTitle: `${tag} ${'x'.repeat(2500)}`, timestamp: NOW });

    const targets = [
      { index: 0, reason: 'url must be a non-empty string', before: failing },
      { index: 1, reason: 'url must be a non-empty string', before: big('a') },
      { index: 2, reason: 'url must be a non-empty string', before: big('b') },
      { index: 3, reason: 'url must be a non-empty string', before: big('c') },
    ];
    const payload = await buildAiRepairPayload(targets);

    // 内訳: 除去失敗1行 + 文字上限で未処理1行 (index 3)。除去済みを重ねて
    // 数えないこと。二重計数の実装では capped.length - items.length = 2 が
    // 加算され 3 になる。
    expect(payload.items).toHaveLength(2);
    expect(payload.omittedRows).toBe(2);
    expect(payload.truncatedChars).toBe(true);
  });
});
