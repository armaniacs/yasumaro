// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * PBI 2026-11-08-04: connectionTests の innerHTML 往復除去の pin。
 *
 * - 往復除去 pin: #status 要素インスタンスの innerHTML setter 呼び出しを数え、
 *   handleTestObsidian / handleTestAi の描画中に書き戻しが発生しないことを固定する。
 *   (mirror 用の getter 読みは Layer 0 の settingsUiHelper 内であり担当外のため数えない)
 * - markup pin: 外部由来文字列 (host・エラー文) に markup が混ざっても
 *   script/img 要素化・実行されず text として描画されることを固定する。
 * - 実時間待ちなし: すべて Promise の await のみ。
 */

vi.mock('../../settingsPipeline.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../settingsPipeline.js')>()),
  saveDashboardSettings: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../../utils/i18n.js', async () => {
  const { mockGetMessage } = await import('../../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return mockGetMessage(getMessage);
});

vi.mock('../../aiTestResultView.js', () => ({
  formatProviderHeadline: vi.fn((p: any) => `headline:${p.provider}`),
  formatProviderDetailLines: vi.fn(() => []),
}));

vi.mock('../../aiTestProgressClient.js', () => ({
  subscribeAiTestProgress: vi.fn(() => vi.fn()),
  generateAiTestRunId: vi.fn(() => 'test-run-id'),
}));

vi.mock('../../aiTestProgressView.js', () => ({
  buildAiTestProgressView: vi.fn(() => {
    const label = document.createElement('span');
    const elapsedEl = document.createElement('div');
    elapsedEl.className = 'ai-test-elapsed';
    return { label, elapsedEl };
  }),
  renderAiTestProgressLabel: vi.fn(),
  renderAiTestProgressElapsed: vi.fn(),
}));

import {
  createConnectionStatusElement,
  handleTestObsidian,
  handleTestAi,
} from '../connectionTests.js';
import { saveDashboardSettings } from '../../settingsPipeline.js';
import { getMessage } from '../../../utils/i18n.js';

const mockedSaveDashboardSettings = vi.mocked(saveDashboardSettings);
const mockedGetMessage = vi.mocked(getMessage);

function setupChrome(sendMessageImpl: (...args: any[]) => any) {
  (globalThis as any).chrome = {
    runtime: {
      id: 'test-extension-id',
      sendMessage: vi.fn(sendMessageImpl),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    i18n: { getMessage: vi.fn((k: string) => k), getUILanguage: vi.fn(() => 'en') },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  };
}

/**
 * 指定要素インスタンスの innerHTML setter 呼び出し回数を数える。
 * getter は元の実装へ委譲する (mirror の読み取りは担当外のため不干渉)。
 */
function countInnerHTMLWrites(el: HTMLElement): { writes: number } {
  let proto: object | null = Object.getPrototypeOf(el);
  let desc: PropertyDescriptor | undefined;
  while (proto && !desc) {
    desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    proto = Object.getPrototypeOf(proto);
  }
  if (!desc?.set || !desc?.get) throw new Error('innerHTML accessor not found');
  const origGet = desc.get.bind(el);
  const origSet = desc.set.bind(el);
  const counter = { writes: 0 };
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() { return origGet(); },
    set(v: string) { counter.writes += 1; origSet(v); },
  });
  return counter;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
  // src/utils/i18n.ts の named-substitution 挙動を再現し、接続ラベルが
  // `<label>: ` 形式になるようにする (既存 connectionTests.test.ts と同型)。
  mockedGetMessage.mockImplementation(((key: string, subs?: unknown) => {
    if (key === 'connectionStatusLabel' && subs !== null && typeof subs === 'object' && 'label' in subs) {
      return `${(subs as Record<string, unknown>).label}: `;
    }
    return key;
  }) as typeof getMessage);
  setupChrome(() => Promise.resolve({}));
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('PBI 2026-11-08-04 — innerHTML 往復なしで装飾が残る', () => {
  it('handleTestObsidian は #status への innerHTML 書き戻しを行わない', async () => {
    document.body.innerHTML = `
      <button id="testObsidianBtn"></button>
      <div id="statusTop"></div>
      <div id="status"></div>
      <input id="apiKey" value="k" />
      <input id="protocol" value="https" />
      <input id="obsidianHost" value="127.0.0.1" />
      <input id="port" value="27124" />
    `;
    setupChrome(() => Promise.resolve({ obsidian: { success: true, message: 'OK' } }));
    const status = document.getElementById('status') as HTMLElement;
    const counter = countInnerHTMLWrites(status);

    await handleTestObsidian();

    expect(counter.writes).toBe(0);
    expect(status.className).toBe('status-message success');
    expect(status.textContent).toContain('Obsidian');
  });

  it('handleTestAi は結果描画で innerHTML 書き戻しを行わない', async () => {
    document.body.innerHTML = `
      <button id="testAiBtn"></button>
      <button id="testAiBtnTop"></button>
      <div id="statusTop"></div>
      <div id="status"></div>
      <form id="panel-general"></form>
    `;
    const ai = { success: true, message: 'OK', providers: [{ provider: 'gemini', success: true, message: 'ok' }] };
    setupChrome(() => Promise.resolve({ ai }));
    const status = document.getElementById('status') as HTMLElement;
    const counter = countInnerHTMLWrites(status);

    await handleTestAi();

    expect(counter.writes).toBe(0);
    expect(status.className).toBe('status-message success');
    expect(status.textContent).toContain('AI');
  });
});

describe('PBI 2026-11-08-04 — 外部由来文字列は escape される', () => {
  const MARKUP_MESSAGE = `<script>window.__pbi110804='pwned'</script><img src="x" onerror="window.__pbi110804='pwned2'">`;

  it('markup 混じりエラー文は要素化・実行されず text として描画される', async () => {
    document.body.innerHTML = `
      <button id="testObsidianBtn"></button>
      <div id="statusTop"></div>
      <div id="status"></div>
      <input id="apiKey" value="k" />
      <input id="protocol" value="https" />
      <input id="obsidianHost" value="127.0.0.1" />
      <input id="port" value="27124" />
    `;
    setupChrome(() => Promise.resolve({ obsidian: { success: false, message: MARKUP_MESSAGE } }));

    await handleTestObsidian();

    const status = document.getElementById('status') as HTMLElement;
    expect(status.querySelector('script')).toBeNull();
    expect(status.querySelector('img')).toBeNull();
    expect(status.querySelector('span.diag-error')?.textContent).toBe(MARKUP_MESSAGE);
    expect((window as unknown as Record<string, unknown>).__pbi110804).toBeUndefined();
  });

  it('createConnectionStatusElement は markup を textContent 経由でのみ描画する', () => {
    const el = createConnectionStatusElement('<b>evil-host</b>', { success: false, message: MARKUP_MESSAGE });
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain(MARKUP_MESSAGE);
    expect((window as unknown as Record<string, unknown>).__pbi110804).toBeUndefined();
  });
});
