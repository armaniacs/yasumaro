// @vitest-environment wasm-quickjs-dom
/**
 * importLogsAiRepairUi.test.ts
 * PBI 2026-11-23-06 / 指摘11-14: 取込結果の却下行に対する
 * 収集→AI提案→差分確認→選択取込の入口。Outside-In の失敗試験。
 * 明示操作のみで送信・取込し、施錠中は案内する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';

const NOW = 1_700_000_000_000;

function invalidParsed(): unknown {
  return {
    version: 1,
    logs: [
      { url: 'https://ok.test/', created_at: NOW, title: 'OK' },
      { pageTitle: 'no url', timestamp: NOW + 1 },
    ],
  };
}

describe('AI repair UI entry (Outside-In)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('却下行があるときだけ入口ボタンを出し、押すまで送信も取込もしない', async () => {
    const { createAiRepairUi } = await import('../importLogsAiRepairUi.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const request = vi.fn(async () => ({ proposals: [], failures: [] }));
    const ui = createAiRepairUi({
      getParsed: () => invalidParsed(),
      clientFactory: () => ({ repairRows: vi.fn(async () => []) }),
      requestFn: request,
    });
    ui.mount(container);
    ui.showForResult({ inserted: 1, skipped: 0, total: 1, invalid: 1 });

    const entry = container.querySelector('[data-ai-repair-entry]');
    expect(entry).not.toBeNull();

    // 明示操作があるまで何も送らない・取り込まない。
    expect(request).not.toHaveBeenCalled();
  });

  it('却下行がなければ入口を出さない', async () => {
    const { createAiRepairUi } = await import('../importLogsAiRepairUi.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const ui = createAiRepairUi({
      getParsed: () => ({ logs: [{ url: 'https://ok.test/', created_at: NOW }] }),
      clientFactory: () => ({ repairRows: vi.fn(async () => []) }),
    });
    ui.mount(container);
    ui.showForResult({ inserted: 1, skipped: 0, total: 1 });

    expect(container.querySelector('[data-ai-repair-entry]')).toBeNull();
  });

  it('施錠中は使えない案内になり送信も取込もしない', async () => {
    const { createAiRepairUi } = await import('../importLogsAiRepairUi.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const repairRows = vi.fn(async () => []);
    const ui = createAiRepairUi({
      getParsed: () => invalidParsed(),
      clientFactory: () => ({ repairRows }),
      lockCheck: async () => true,
    });
    ui.mount(container);
    ui.showForResult({ inserted: 1, skipped: 0, total: 1, invalid: 1 });

    const entry = container.querySelector('[data-ai-repair-entry]') as HTMLButtonElement | null;
    expect(entry).not.toBeNull();
    entry?.click();
    // 施錠判定は非同期だが送信は起きない。案内が出るまで条件待ちする。
    await waitForMock(() => expect(container.textContent ?? '').toMatch(/lock/i));

    expect(repairRows).not.toHaveBeenCalled();
  });

  it('提案の差分を示し選択行だけ取り込む', async () => {
    const { createAiRepairUi } = await import('../importLogsAiRepairUi.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const proposals = [
      { index: 1, reason: 'url must be a non-empty string', before: '{"title":"A"}', after: '{"title":"A","url":"https://fixed.test/","created_at":1700000000000}' },
    ];
    const apply = vi.fn(async () => ({ applied: 1, rejected: [] }));
    const ui = createAiRepairUi({
      getParsed: () => invalidParsed(),
      clientFactory: () => ({
        repairRows: vi.fn(async (rows: Array<{ index: number; text: string }>) =>
          rows.map((r) => ({ index: r.index, text: proposals[0]!.after }))
        ),
      }),
      applyFn: apply,
    });
    ui.mount(container);
    ui.showForResult({ inserted: 1, skipped: 0, total: 1, invalid: 1 });

    (container.querySelector('[data-ai-repair-entry]') as HTMLButtonElement | null)?.click();
    // 差分が出るまで条件待ちする (固定スリープ禁止)。
    await waitForMock(() =>
      expect(
        container.querySelector('[data-ai-repair-diff]')?.textContent ?? ''
      ).toContain('https://fixed.test/')
    );

    // 差分が - / + で示される。
    const diff = container.querySelector('[data-ai-repair-diff]');
    expect(diff).not.toBeNull();
    expect(diff?.textContent ?? '').toContain('https://fixed.test/');

    // 選択して取り込む (明示操作)。
    const checkbox = container.querySelector('[data-ai-repair-select]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    if (checkbox) checkbox.checked = true;
    (container.querySelector('[data-ai-repair-apply]') as HTMLButtonElement | null)?.click();
    await waitForMock(() => expect(apply).toHaveBeenCalledTimes(1));

    expect(apply).toHaveBeenCalledTimes(1);
    expect((apply.mock.calls[0] as unknown[] | undefined)?.[1]).toEqual([1]);
  });
});

describe('AI repair client adapter', () => {
  it('既存の后台AI経路 generateSummary を再利用し新規fetchを作らない', async () => {
    const { createAiServiceRepairClient } = await import('../importLogsAiRepairClient.js');
    const generateSummary = vi.fn(async () => ({
      success: true,
      summary: '```json\n{"url":"https://fixed.test/","created_at":1700000000000}\n```',
    }));
    const client = createAiServiceRepairClient({ generateSummary } as unknown as {
      generateSummary: (content: string, options?: unknown) => Promise<{ success: boolean; summary: string }>;
    });

    const out = await client.repairRows([{ index: 1, text: '{"title":"A"}' }]);

    expect(generateSummary).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]?.index).toBe(1);
    expect(() => JSON.parse(out[0]?.text ?? '')).not.toThrow();
  });

  it('AI失敗時は例外にせず壊れた応答として返し取込に進ませない', async () => {
    const { createAiServiceRepairClient } = await import('../importLogsAiRepairClient.js');
    const client = createAiServiceRepairClient({
      generateSummary: async () => ({ success: false, summary: 'Error: boom' }),
    } as unknown as {
      generateSummary: (content: string, options?: unknown) => Promise<{ success: boolean; summary: string }>;
    });

    const out = await client.repairRows([{ index: 2, text: '{"title":"B"}' }]);
    expect(out).toHaveLength(1);
    expect(() => JSON.parse(out[0]?.text ?? '')).toThrow();
  });
});
