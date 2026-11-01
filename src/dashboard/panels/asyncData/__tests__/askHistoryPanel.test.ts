// @vitest-environment jsdom
/**
 * askHistoryPanel.test.ts (PBI 2026-11-01-02)
 * New sibling panel `panel-ask-history`: owns the question + target
 * collection selection with panel-local state (no history dependence).
 * The collection list loads DIRECTLY from the saved-collections repository;
 * generation reuses the existing askHistoryGateway path (busy guard,
 * 60s timeout, refusal-reason paint, retry).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../messaging/askHistoryGateway.js', () => ({
  askHistory: vi.fn(),
}));

vi.mock('../../../../utils/storage/savedCollectionsRepository.js', () => ({
  getSavedCollections: vi.fn().mockResolvedValue({}),
}));

import { askHistory } from '../../../../messaging/askHistoryGateway.js';
import { getSavedCollections } from '../../../../utils/storage/savedCollectionsRepository.js';
import {
  createAskHistoryPanel,
  ASK_HISTORY_PANEL_REGION_ID,
} from '../askHistoryPanel.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';

const mockedAsk = askHistory as unknown as ReturnType<typeof vi.fn>;
const mockedGetSaved = getSavedCollections as unknown as ReturnType<typeof vi.fn>;

function collection(id: string, name: string, updatedAt: number): SavedCollection {
  return { id, name, query: { tag: 'wasm' }, createdAt: updatedAt, updatedAt };
}

function mountSection(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'panel-ask-history';
  // No history-shell ids here by design: the panel must work standalone.
  section.innerHTML = `<div id="${ASK_HISTORY_PANEL_REGION_ID}"></div>`;
  document.body.appendChild(section);
  return section;
}

function askControls(section: HTMLElement): {
  input: HTMLInputElement;
  button: HTMLButtonElement;
  target: HTMLSelectElement;
} {
  const input = section.querySelector<HTMLInputElement>('.ask-history-question');
  const button = section.querySelector<HTMLButtonElement>('[data-ask-action="ask"]');
  const target = section.querySelector<HTMLSelectElement>('.ask-history-target');
  expect(input).not.toBeNull();
  expect(button).not.toBeNull();
  expect(target).not.toBeNull();
  return { input: input!, button: button!, target: target! };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSaved.mockResolvedValue({});
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('askHistoryPanel — PanelLifecycle', () => {
  it('declares the new panel id and async-data category', () => {
    const panel = createAskHistoryPanel();
    expect(panel.id).toBe('panel-ask-history');
    expect(panel.category).toBe('async-data');
  });

  it('mount → load → destroy succeeds with no collections (BDD 空状態)', async () => {
    const panel = createAskHistoryPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();
    const { target } = askControls(section);
    expect([...target.options].map((o) => o.value)).toEqual(['']);
    expect(() => panel.destroy?.()).not.toThrow();
  });

  it('load without a prior mount resolves (registry safety)', async () => {
    const panel = createAskHistoryPanel();
    await expect(panel.load?.()).resolves.toBeUndefined();
  });
});

describe('askHistoryPanel — collection list loads directly (no history state)', () => {
  it('lists the repository collections as ask targets', async () => {
    mockedGetSaved.mockResolvedValue({
      c1: collection('c1', 'Rust notes', 2),
      c2: collection('c2', 'Wasm lab', 1),
    });
    const panel = createAskHistoryPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    expect(mockedGetSaved).toHaveBeenCalledTimes(1);
    const { target } = askControls(section);
    expect([...target.options].map((o) => o.value)).toEqual(['', 'c1', 'c2']);
    panel.destroy?.();
  });

  it('renders the load reason inside the panel and resolves instead of throwing', async () => {
    mockedGetSaved.mockRejectedValueOnce(new Error('db down'));
    const panel = createAskHistoryPanel();
    const section = mountSection();
    panel.mount(section);
    await expect(panel.load?.()).resolves.toBeUndefined();

    const alert = section.querySelector('.ask-history-load-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('db down');
    panel.destroy?.();
  });
});

describe('askHistoryPanel — ask flow (BDD 回答・証拠なし・失敗と再試行)', () => {
  it('paints the answer with citation links back to the records', async () => {
    mockedGetSaved.mockResolvedValue({ c1: collection('c1', 'Rust notes', 2) });
    mockedAsk.mockResolvedValue({
      success: true,
      status: 'answered',
      answer: '答えの本文',
      citations: [{ id: 11, title: 'Record 11', url: 'https://example.com/11', snippet: '引用11' }],
    });
    const panel = createAskHistoryPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    const { input, button, target } = askControls(section);
    target.value = 'c1';
    input.value = 'WASMの検証結果は?';
    button.click();

    await vi.waitFor(() => {
      expect(section.querySelector('.ask-answer-text')?.textContent).toBe('答えの本文');
    });
    expect(mockedAsk).toHaveBeenCalledWith({ question: 'WASMの検証結果は?', collectionId: 'c1' });
    const link = section.querySelector<HTMLAnchorElement>('.ask-citation-link');
    expect(link?.getAttribute('href')).toBe('https://example.com/11');
    expect(link?.getAttribute('target')).toBe('_blank');
    panel.destroy?.();
  });

  it('paints the widening suggestion with no answer on no_evidence (BDD 分かりません)', async () => {
    mockedAsk.mockResolvedValue({ success: true, status: 'no_evidence', suggestion: '対象を広げてください' });
    const panel = createAskHistoryPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    const { input, button } = askControls(section);
    input.value = '存在しない話題';
    button.click();

    await vi.waitFor(() => {
      expect(section.querySelector('.ask-history-status')?.textContent).toBe('対象を広げてください');
    });
    expect(section.querySelector('.ask-answer-text')).toBeNull();
    panel.destroy?.();
  });

  it('paints the failure reason and retries on the next ask (BDD 失敗と再試行)', async () => {
    mockedAsk.mockResolvedValueOnce({ success: false, error: 'boom' });
    mockedAsk.mockResolvedValueOnce({ success: true, status: 'answered', answer: '再試行の答え', citations: [] });
    const panel = createAskHistoryPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    const { input, button } = askControls(section);
    input.value = '何か聞く';
    button.click();
    await vi.waitFor(() => {
      expect(section.querySelector('.ask-history-status')?.textContent).toContain('boom');
    });
    expect(section.querySelector('.ask-answer-text')).toBeNull();
    // Retry: the button is clickable again and the second run paints.
    input.value = 'もう一度聞く';
    button.click();
    await vi.waitFor(() => {
      expect(section.querySelector('.ask-answer-text')?.textContent).toBe('再試行の答え');
    });
    expect(mockedAsk).toHaveBeenCalledTimes(2);
    panel.destroy?.();
  });

  it('blocks a second run while one is in flight (二重実行防止)', async () => {
    let resolveAsk!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      resolveAsk = resolve;
    });
    mockedAsk.mockReturnValueOnce(gate);
    const panel = createAskHistoryPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    const { input, button } = askControls(section);
    input.value = '重い質問';
    button.click();
    await vi.waitFor(() => {
      expect(button.disabled).toBe(true);
    });
    button.click();
    expect(mockedAsk).toHaveBeenCalledTimes(1);

    resolveAsk({ success: true, status: 'answered', answer: '答え', citations: [] });
    await vi.waitFor(() => {
      expect(section.querySelector('.ask-answer-text')?.textContent).toBe('答え');
    });
    expect(button.disabled).toBe(false);
    panel.destroy?.();
  });
});
