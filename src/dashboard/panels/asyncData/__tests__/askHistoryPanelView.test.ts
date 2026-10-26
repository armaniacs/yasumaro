// @vitest-environment jsdom
/**
 * askHistoryPanelView.test.ts
 * PBI 2026-10-23-08 — region render + ask flow paint.
 * Pins: the target select lists the saved collections, the answered path
 * paints the answer with citation links back to the records (new-tab links
 * with noopener), no_evidence paints the widening suggestion with no answer,
 * and failures paint the translated error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../messaging/askHistoryGateway.js', () => ({
  askHistory: vi.fn(),
}));

import { askHistory } from '../../../../messaging/askHistoryGateway.js';
import {
  ASK_HISTORY_REGION_ID,
  createAskHistoryActions,
  renderAskHistoryRegion,
} from '../askHistoryPanelView.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';

const mockedAsk = askHistory as unknown as ReturnType<typeof vi.fn>;

function collection(id: string, name: string, updatedAt: number): SavedCollection {
  return { id, name, query: { tag: 'wasm' }, createdAt: updatedAt, updatedAt };
}

function mount(collections: Record<string, SavedCollection>): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = `<div id="${ASK_HISTORY_REGION_ID}"></div>`;
  document.body.appendChild(container);
  renderAskHistoryRegion(container, collections, createAskHistoryActions((error) => `T:${error}`));
  return container;
}

function ask(container: HTMLElement, question: string): void {
  const input = container.querySelector<HTMLInputElement>('.ask-history-question');
  const button = container.querySelector<HTMLButtonElement>('[data-ask-action="ask"]');
  expect(input).not.toBeNull();
  expect(button).not.toBeNull();
  input!.value = question;
  button!.click();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderAskHistoryRegion', () => {
  it('lists the saved collections as ask targets behind the all-targets option', () => {
    const container = mount({ c1: collection('c1', 'Rust notes', 2), c2: collection('c2', 'Wasm lab', 1) });

    const options = [...container.querySelectorAll<HTMLSelectElement>('.ask-history-target option')];
    expect(options.map((o) => o.value)).toEqual(['', 'c1', 'c2']);
    expect(options.map((o) => o.textContent)).toContain('Rust notes');
  });

  it('paints the answer with citation links back to the records', async () => {
    mockedAsk.mockResolvedValue({
      success: true,
      status: 'answered',
      answer: '答えの本文',
      citations: [
        { id: 11, title: 'Record 11', url: 'https://example.com/11', snippet: '引用11' },
        { id: 12, title: 'Record 12', url: 'https://example.com/12', snippet: '引用12' },
      ],
    });
    const container = mount({});

    ask(container, 'WASMの検証結果は?');

    await vi.waitFor(() => {
      expect(container.querySelector('.ask-answer-text')?.textContent).toBe('答えの本文');
    });
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.ask-citation-link')];
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/11');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0]?.dataset.entryId).toBe('11');
    // The busy line clears once the answer lands.
    expect(container.querySelector('.ask-history-status')?.textContent).toBe('');
  });

  it('paints the widening suggestion with no answer on no_evidence', async () => {
    mockedAsk.mockResolvedValue({ success: true, status: 'no_evidence', suggestion: '対象を広げてください' });
    const container = mount({});

    ask(container, '存在しない話題');

    await vi.waitFor(() => {
      expect(container.querySelector('.ask-history-status')?.textContent).toBe('対象を広げてください');
    });
    expect(container.querySelector('.ask-answer-text')).toBeNull();
  });

  it('paints the translated error on failure', async () => {
    mockedAsk.mockResolvedValue({ success: false, error: 'boom' });
    const container = mount({});

    ask(container, '何か聞く');

    await vi.waitFor(() => {
      expect(container.querySelector('.ask-history-status')?.textContent).toBe('T:boom');
    });
    expect(container.querySelector('.ask-answer-text')).toBeNull();
  });
});
