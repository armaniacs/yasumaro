import { describe, it, expect, vi, beforeEach } from 'vitest';

import { recordTabContent, type RecordTabContentDeps } from '../activeTabRecorder.js';
import { SELECTION_MAX_CHARS } from '../../../utils/selectionText.js';

interface Harness {
  handleManualRecord: ReturnType<typeof vi.fn>;
  executeScript: ReturnType<typeof vi.fn>;
}

function makeHarness(extracted: unknown): Harness {
  const handleManualRecord = vi.fn(async () => undefined);
  const executeScript = vi.fn().mockResolvedValue([{ result: extracted }]);
  return { handleManualRecord, executeScript };
}

function makeDeps(h: Harness): RecordTabContentDeps {
  return {
    handleManualRecord: h.handleManualRecord as unknown as RecordTabContentDeps['handleManualRecord'],
    executeScript: h.executeScript as unknown as typeof chrome.scripting.executeScript,
  };
}

function lastPayload(h: Harness): { type: string; payload: Record<string, unknown> } {
  const message = h.handleManualRecord.mock.calls[0]![0] as { type: string; payload: Record<string, unknown> };
  return message;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordTabContent selection capture (PBI 2026-10-31-03)', () => {
  it('records only the selection with the selection-origin marker when one exists', async () => {
    const h = makeHarness({ url: 'https://example.com/x', title: 'X', content: 'page body', selection: 'selected paragraph' });
    await recordTabContent(makeDeps(h), 'Keyboard', 7, 'https://example.com');

    expect(h.handleManualRecord).toHaveBeenCalledTimes(1);
    const message = lastPayload(h);
    expect(message.type).toBe('MANUAL_RECORD');
    expect(message.payload.content).toBe('selected paragraph');
    expect(message.payload.contentOrigin).toBe('selection');
  });

  it('normalizes the selection in the service worker (line separators + runs of spaces)', async () => {
    const h = makeHarness({ url: 'https://example.com/x', title: 'X', content: 'page body', selection: 'a\u2028b\u2029c\u0085d    e' });
    await recordTabContent(makeDeps(h), 'Keyboard', 7, 'https://example.com');

    const message = lastPayload(h);
    expect(message.payload.content).toBe('a b c d e');
    expect(message.payload.contentOrigin).toBe('selection');
  });

  it(`truncates a selection beyond the ${SELECTION_MAX_CHARS}-char cap and still records`, async () => {
    const h = makeHarness({ url: 'https://example.com/x', title: 'X', content: 'page body', selection: 'y'.repeat(SELECTION_MAX_CHARS + 500) });
    await recordTabContent(makeDeps(h), 'Keyboard', 7, 'https://example.com');

    const message = lastPayload(h);
    expect(message.payload.content).toHaveLength(SELECTION_MAX_CHARS);
  });

  it('falls back to the page-body record when nothing is selected (backward compatible)', async () => {
    const h = makeHarness({ url: 'https://example.com/x', title: 'X', content: 'page body', selection: '' });
    await recordTabContent(makeDeps(h), 'Context menu', 7, 'https://example.com');

    const message = lastPayload(h);
    expect(message.payload.content).toBe('page body');
    expect('contentOrigin' in message.payload).toBe(false);
  });

  it('falls back to the page-body record when the extracted data carries no selection', async () => {
    const h = makeHarness({ url: 'https://example.com/x', title: 'X', content: 'page body' });
    await recordTabContent(makeDeps(h), 'Context menu', 7, 'https://example.com');

    const message = lastPayload(h);
    expect(message.payload.content).toBe('page body');
    expect('contentOrigin' in message.payload).toBe(false);
  });
});
