// @vitest-environment jsdom
/**
 * regionAction.parity.test.ts (PBI 2026-11-11-06)
 * Parity pins for the ask/report region skeleton unification.
 *
 * The sqliteHistory pending-row in-row paint is explicitly out of scope
 * (pendingRowRenderer owns that contract) and is not covered here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../messaging/askHistoryGateway.js', () => ({
  askHistory: vi.fn(),
}));

vi.mock('../../../../messaging/researchReportGateway.js', () => ({
  exportResearchReport: vi.fn(),
}));

import { askHistory } from '../../../../messaging/askHistoryGateway.js';
import { exportResearchReport } from '../../../../messaging/researchReportGateway.js';
import { tOrKey as t } from '../../../../utils/i18n.js';
import { buildStatusDivHtml, runRegionAction } from '../regionAction.js';
import {
  ASK_HISTORY_REGION_ID,
  createAskHistoryActions,
  renderAskHistoryRegion,
} from '../askHistoryPanelView.js';
import {
  RESEARCH_REPORT_REGION_ID,
  createResearchReportActions,
  createResearchReportPanelActions,
  renderResearchReportRegion,
  renderResearchReportPanelRegion,
} from '../researchReportPanelView.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';

const mockedAsk = askHistory as unknown as ReturnType<typeof vi.fn>;
const mockedReport = exportResearchReport as unknown as ReturnType<typeof vi.fn>;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('buildStatusDivHtml — status div定型の定数化', () => {
  it('replaces the literals byte-identically', () => {
    expect(buildStatusDivHtml('ask-history-status')).toBe(
      '<div class="ask-history-status" role="status" aria-live="polite"></div>',
    );
    expect(buildStatusDivHtml('research-report-status')).toBe(
      '<div class="research-report-status" role="status" aria-live="polite"></div>',
    );
    expect(buildStatusDivHtml('domain-intel-status')).toBe(
      '<div class="domain-intel-status" role="status" aria-live="polite"></div>',
    );
  });
});

describe('runRegionAction — 遷移の一元化', () => {
  function setup(): { button: HTMLButtonElement; seen: string[] } {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const seen: string[] = [];
    return { button, seen };
  }

  it('paints busy then hands the ok result to onSuccess', async () => {
    const { button, seen } = setup();
    await runRegionAction(
      button,
      (message) => seen.push(message),
      { busy: 'busy!', failed: 'failed!' },
      async () => ({ ok: true as const, value: 42 }),
      (result) => seen.push(`ok:${result.value}`),
    );
    expect(seen).toEqual(['busy!', 'ok:42']);
    expect(button.disabled).toBe(false);
  });

  it('paints the failure reason, falling back to failed', async () => {
    const { button, seen } = setup();
    await runRegionAction(
      button,
      (message) => seen.push(message),
      { busy: 'busy!', failed: 'failed!' },
      async () => ({ ok: false as const, error: 'nope' }),
      () => seen.push('must-not-run'),
    );
    expect(seen).toEqual(['busy!', 'nope']);

    seen.length = 0;
    await runRegionAction(
      button,
      (message) => seen.push(message),
      { busy: 'busy!', failed: 'failed!' },
      async () => ({ ok: false as const }),
      () => seen.push('must-not-run'),
    );
    expect(seen).toEqual(['busy!', 'failed!']);
  });

  it('paints the thrown message, falling back to failed', async () => {
    const { button, seen } = setup();
    await runRegionAction(
      button,
      (message) => seen.push(message),
      { busy: 'busy!', failed: 'failed!' },
      async (): Promise<{ ok: boolean }> => {
        throw new Error('thrown!');
      },
      () => seen.push('must-not-run'),
    );
    expect(seen).toEqual(['busy!', 'thrown!']);
  });

  it('disables the button for the run (二重実行ガード)', async () => {
    const { button, seen } = setup();
    const gate = deferred<{ ok: boolean }>();
    const running = runRegionAction(
      button,
      (message) => seen.push(message),
      { busy: 'busy!', failed: 'failed!' },
      () => gate.promise,
      () => undefined,
    );
    expect(button.disabled).toBe(true);
    gate.resolve({ ok: true });
    await running;
    expect(button.disabled).toBe(false);
  });

  it('runs beforeRun before the busy paint', async () => {
    const { button, seen } = setup();
    await runRegionAction(
      button,
      (message) => seen.push(message),
      { busy: 'busy!', failed: 'failed!' },
      async () => ({ ok: true as const }),
      () => undefined,
      () => seen.push('before'),
    );
    expect(seen).toEqual(['before', 'busy!']);
  });
});

describe('ask region parity — 操作結果の表示は変わらない', () => {
  function mountAsk(): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = `<div id="${ASK_HISTORY_REGION_ID}"></div>`;
    document.body.appendChild(container);
    renderAskHistoryRegion(container, {}, createAskHistoryActions((error) => `T:${error}`));
    return container;
  }

  function askNow(container: HTMLElement, question: string): HTMLButtonElement {
    const input = container.querySelector<HTMLInputElement>('.ask-history-question')!;
    const button = container.querySelector<HTMLButtonElement>('[data-ask-action="ask"]')!;
    input.value = question;
    button.click();
    return button;
  }

  it('shows the busy line synchronously on click', async () => {
    const gate = deferred<never>();
    mockedAsk.mockReturnValueOnce(gate.promise);
    const container = mountAsk();
    askNow(container, 'q?');
    expect(container.querySelector('.ask-history-status')?.textContent).toBe(t('askHistoryBusy'));
    gate.resolve(undefined as never);
    await vi.waitFor(() => {
      expect(mockedAsk).toHaveBeenCalled();
    });
  });

  it('paints the suggestion with no answer on no_evidence', async () => {
    mockedAsk.mockResolvedValue({ success: true, status: 'no_evidence', suggestion: '広げて' });
    const container = mountAsk();
    askNow(container, 'q?');
    await vi.waitFor(() => {
      expect(container.querySelector('.ask-history-status')?.textContent).toBe('広げて');
    });
    expect(container.querySelector('.ask-answer-text')).toBeNull();
  });

  it('paints the translated error on failure', async () => {
    mockedAsk.mockResolvedValue({ success: false, error: 'boom' });
    const container = mountAsk();
    askNow(container, 'q?');
    await vi.waitFor(() => {
      expect(container.querySelector('.ask-history-status')?.textContent).toBe('T:boom');
    });
    expect(container.querySelector('.ask-answer-text')).toBeNull();
  });

  it('paints the thrown message on exception', async () => {
    const container = document.createElement('div');
    container.innerHTML = `<div id="${ASK_HISTORY_REGION_ID}"></div>`;
    document.body.appendChild(container);
    renderAskHistoryRegion(container, {}, {
      onAsk: async () => {
        throw new Error('region boom');
      },
    });
    askNow(container, 'q?');
    await vi.waitFor(() => {
      expect(container.querySelector('.ask-history-status')?.textContent).toBe('region boom');
    });
    expect(container.querySelector('.ask-answer-text')).toBeNull();
  });

  it('ignores a double click while busy (全region同一ガード)', async () => {
    const gate = deferred<{ success: boolean; status: string; answer: string; citations: [] }>();
    mockedAsk.mockReturnValueOnce(gate.promise);
    const container = mountAsk();
    const button = askNow(container, 'q?');
    expect(button.disabled).toBe(true);
    button.click();
    gate.resolve({ success: true, status: 'answered', answer: 'A', citations: [] });
    await vi.waitFor(() => {
      expect(container.querySelector('.ask-answer-text')?.textContent).toBe('A');
    });
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });
});

describe('report region parity — 操作結果の表示は変わらない', () => {
  function mountHistory(): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = `<div id="${RESEARCH_REPORT_REGION_ID}"></div>`;
    document.body.appendChild(container);
    renderResearchReportRegion(
      container,
      createResearchReportActions(() => ({
        searchQuery: '',
        activeTagFilter: null,
        selectedDate: null,
      })),
    );
    return container;
  }

  function mountPanel(): { container: HTMLElement; button: HTMLButtonElement } {
    const stored: Record<string, SavedCollection> = {};
    const container = document.createElement('div');
    container.innerHTML = '<div id="report-parity-region"></div>';
    document.body.appendChild(container);
    renderResearchReportPanelRegion(
      container,
      stored,
      createResearchReportPanelActions(() => stored),
      'report-parity-region',
    );
    const button = container.querySelector<HTMLButtonElement>('[data-report-action="generate"]')!;
    return { container, button };
  }

  it('history: paints done(count) on success', async () => {
    mockedReport.mockResolvedValue({ success: true, recordCount: 3 });
    const container = mountHistory();
    container.querySelector<HTMLButtonElement>('[data-report-action="generate"]')!.click();
    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe(
        t('researchReportDone', ['3']),
      );
    });
  });

  it('history: paints the raw reason on failure and the thrown message on exception', async () => {
    mockedReport.mockResolvedValueOnce({ success: false, error: 'no matching records' });
    const container = mountHistory();
    container.querySelector<HTMLButtonElement>('[data-report-action="generate"]')!.click();
    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe('no matching records');
    });

    mockedReport.mockRejectedValueOnce(new Error('wire down'));
    const container2 = mountHistory();
    container2.querySelector<HTMLButtonElement>('[data-report-action="generate"]')!.click();
    await vi.waitFor(() => {
      // The gateway resolves failures; a throw here surfaces through the
      // action bundle as { ok:false } with the extracted message.
      expect(container2.querySelector('.research-report-status')?.textContent).toBe('wire down');
    });
  });

  it('panel: failure keeps the button retryable and resends (BDD 再送)', async () => {
    mockedReport.mockResolvedValueOnce({ success: false, error: 'send down' });
    mockedReport.mockResolvedValueOnce({ success: true, recordCount: 5 });
    const { container, button } = mountPanel();
    button.click();
    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe('send down');
    });
    expect(button.disabled).toBe(false);

    button.click();
    await vi.waitFor(() => {
      expect(mockedReport).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe(
        t('researchReportDone', ['5']),
      );
    });
  });

  it('panel: ignores a double click while busy (全region同一ガード)', async () => {
    const gate = deferred<{ success: boolean; recordCount: number }>();
    mockedReport.mockReturnValueOnce(gate.promise);
    const { container, button } = mountPanel();
    button.click();
    expect(button.disabled).toBe(true);
    button.click();
    gate.resolve({ success: true, recordCount: 1 });
    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe(
        t('researchReportDone', ['1']),
      );
    });
    expect(mockedReport).toHaveBeenCalledTimes(1);
  });
});
