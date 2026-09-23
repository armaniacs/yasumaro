import { describe, it, expect, vi } from 'vitest';
import { createSaveRecordHandler } from '../recordingHandlers.js';
import type { SaveRecordHandlerDeps } from '../recordingHandlers.js';
import type { SaveRecordMessage } from '../../messageTypes.js';
import type { RecordingData } from '../../../messaging/types.js';
import { extractCommonStorageFields } from '../../pipeline/mappers/commonStorageFields.js';
import type { RecordingContext } from '../../pipeline/types.js';

function makeSaveDeps(
  overrides: Partial<SaveRecordHandlerDeps> = {},
): SaveRecordHandlerDeps {
  return {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    recordingPipeline: { record: vi.fn().mockResolvedValue({ success: true }) } as SaveRecordHandlerDeps['recordingPipeline'],
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function saveMessage(maskedCount: number): SaveRecordMessage {
  return {
    type: 'SAVE_RECORD',
    payload: {
      url: 'https://example.com/',
      title: 'T',
      content: 'hello world, no PII here',
      maskedCount,
    },
  } as SaveRecordMessage;
}

describe('SAVE_RECORD caller maskedCount is discarded', () => {
  it('does not forward the caller maskedCount into the record request', async () => {
    const record = vi.fn().mockResolvedValue({ success: true });
    const deps = makeSaveDeps({ recordingPipeline: { record } as never });
    const handler = createSaveRecordHandler(deps);

    await handler(
      saveMessage(999),
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      vi.fn(),
    );

    expect(record).toHaveBeenCalledTimes(1);
    const data = record.mock.calls[0][0] as RecordingData;
    expect(data.maskedCount).toBeUndefined();
  });

  it('stores the pipeline-computed maskedCount even when the caller sends 999', async () => {
    let captured: RecordingData | undefined;
    const record = vi.fn().mockImplementation(async (data: RecordingData) => {
      captured = data;
      return { success: true };
    });
    const deps = makeSaveDeps({ recordingPipeline: { record } as never });
    const handler = createSaveRecordHandler(deps);

    await handler(
      saveMessage(999),
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      vi.fn(),
    );

    const context = {
      data: captured,
      privacyResult: { summary: '', maskedCount: 0, tags: [] },
    } as unknown as RecordingContext;
    const common = extractCommonStorageFields(context);

    expect(common.maskedCount).toBe(0);
    expect(common.toMetadataPatch().maskedCount).toBeUndefined();
  });

  it('still stores the pipeline value on the normal save flow', async () => {
    let captured: RecordingData | undefined;
    const record = vi.fn().mockImplementation(async (data: RecordingData) => {
      captured = data;
      return { success: true };
    });
    const deps = makeSaveDeps({ recordingPipeline: { record } as never });
    const handler = createSaveRecordHandler(deps);

    await handler(
      {
        type: 'SAVE_RECORD',
        payload: { url: 'https://example.com/', title: 'T', content: 'body' },
      } as SaveRecordMessage,
      { id: 'test-extension-id' } as chrome.runtime.MessageSender,
      vi.fn(),
    );

    const context = {
      data: captured,
      privacyResult: { summary: 's', maskedCount: 3, tags: [] },
    } as unknown as RecordingContext;
    const common = extractCommonStorageFields(context);

    expect(common.maskedCount).toBe(3);
  });
});
