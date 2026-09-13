// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock, showPreviewMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  showPreviewMock: vi.fn(),
}));

vi.mock('../../../messaging/messageTransport.js', () => ({
  messageTransport: {
    send: (message: unknown) => sendMock(message),
  },
}));

vi.mock('../../sanitizePreview.js', () => ({
  showPreview: (...args: unknown[]) => showPreviewMock(...args),
  initializeModalEvents: vi.fn(),
}));

vi.mock('../../../utils/storage/SettingsRepository.js', () => ({
  SettingsRepository: class {
    async getAll(): Promise<Record<string, unknown>> {
      return { pii_confirmation_ui: true };
    }
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  logError: vi.fn(),
  ErrorCode: { CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE' },
}));

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: (key: string) => key,
}));

import { PreviewFlow, buildRecordPayload } from '../previewFlow.js';
import { SpinnerScope } from '../../spinner.js';

function makeTab(): chrome.tabs.Tab {
  return { id: 1, title: 'T', url: 'https://example.com' } as chrome.tabs.Tab;
}

function mountSpinner(): HTMLElement {
  document.body.innerHTML = '<div id="loadingSpinner" style="display:none"><span class="spinner-text"></span></div>';
  return document.getElementById('loadingSpinner') as HTMLElement;
}

describe('buildRecordPayload (PBI 2026-09-12-14)', () => {
  it('carries the full stat set for all three envelopes', () => {
    const tab = makeTab();
    const stats = {
      byteStats: { pageBytes: 1, candidateBytes: 2, originalBytes: 3, cleansedBytes: 4 },
      aiSummaryCleansedStats: {
        aiSummaryOriginalBytes: 5,
        aiSummaryCleansedBytes: 6,
        aiSummaryCleansedElements: 7,
        aiSummaryCleansedReason: 'hard',
        aiSummaryCleansedReasons: ['hard'],
      },
    } as never;

    for (const content of ['original', 'confirmed']) {
      const payload = buildRecordPayload(tab, content, true, stats);
      expect(payload).toMatchObject({
        title: 'T',
        url: 'https://example.com',
        content,
        force: true,
        pageBytes: 1,
        candidateBytes: 2,
        originalBytes: 3,
        cleansedBytes: 4,
        aiSummaryOriginalBytes: 5,
        aiSummaryCleansedBytes: 6,
        aiSummaryCleansedElements: 7,
        aiSummaryCleansedReason: 'hard',
        aiSummaryCleansedReasons: ['hard'],
      });
    }
  });

  it('attaches maskedCount only when provided (SAVE envelope)', () => {
    const tab = makeTab();
    expect(buildRecordPayload(tab, 'c', true, {})).not.toHaveProperty('maskedCount');
    expect(buildRecordPayload(tab, 'c', true, { maskedCount: 3 })).toMatchObject({ maskedCount: 3 });
  });
});

describe('SpinnerScope (PBI 2026-09-12-14)', () => {
  beforeEach(() => {
    mountSpinner();
  });

  it('balances show/show/hide to hidden', () => {
    const spinner = document.getElementById('loadingSpinner') as HTMLElement;
    const scope = new SpinnerScope();
    scope.show('a');
    expect(spinner.style.display).toBe('flex');
    scope.show('b');
    scope.hide();
    expect(spinner.style.display).toBe('none');
  });

  it('hide without show is a no-op', () => {
    const spinner = document.getElementById('loadingSpinner') as HTMLElement;
    const scope = new SpinnerScope();
    expect(() => scope.hide()).not.toThrow();
    expect(spinner.style.display).toBe('none');
  });
});

describe('PreviewFlow.run error normalization (PBI 2026-09-12-14)', () => {
  beforeEach(() => {
    mountSpinner();
    sendMock.mockReset();
    showPreviewMock.mockReset();
  });

  it('returns instead of throwing on no-response, with spinner hidden', async () => {
    sendMock.mockResolvedValue(undefined);
    const flow = new PreviewFlow();
    const result = await flow.run({ tab: makeTab(), content: 'c', force: true });
    expect(result).toEqual({ success: false, error: 'No response from background worker' });
    expect((document.getElementById('loadingSpinner') as HTMLElement).style.display).toBe('none');
  });

  it('returns instead of throwing on background failure, with spinner hidden', async () => {
    sendMock.mockResolvedValue({ success: false, error: 'Processing failed' });
    const flow = new PreviewFlow();
    const result = await flow.run({ tab: makeTab(), content: 'c', force: true });
    expect(result).toEqual({ success: false, error: 'Processing failed' });
    expect((document.getElementById('loadingSpinner') as HTMLElement).style.display).toBe('none');
  });

  it('sends the confirmed content (not the original) on SAVE', async () => {
    sendMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'PREVIEW_RECORD') {
        return { success: true, maskedCount: 2, processedContent: 'orig', maskedItems: [] };
      }
      return { success: true };
    });
    showPreviewMock.mockResolvedValue({ confirmed: true, content: 'confirmed-edited' });
    const flow = new PreviewFlow();
    const result = await flow.run({ tab: makeTab(), content: 'orig', force: true });
    expect(result.success).toBe(true);
    const saveCall = sendMock.mock.calls.find(([m]) => (m as { type: string }).type === 'SAVE_RECORD');
    expect(saveCall).toBeDefined();
    expect((saveCall![0] as { payload: Record<string, unknown> }).payload).toMatchObject({ content: 'confirmed-edited' });
  });
});
