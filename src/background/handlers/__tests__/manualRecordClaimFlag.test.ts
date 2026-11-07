/**
 * manualRecordClaimFlag.test.ts — PBI 2026-11-07-19.
 *
 * Pins the caller side of the claim move: the manual/preview handler builds
 * the request and hands claim ownership to the orchestrator through the
 * `acquireRecoveryClaim` flag — it never calls the claim store itself.
 * Save (and every other non-recovery surface) keeps the flag-free call.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createManualRecordHandler,
  createSaveRecordHandler,
  type ManualRecordHandlerDeps,
  type SaveRecordHandlerDeps,
} from '../recordingHandlers.js';
import type {
  ManualRecordMessage,
  PreviewRecordMessage,
  SaveRecordMessage,
} from '../../messageTypes.js';

const EXTENSION_SENDER = { id: 'test-extension-id' } as chrome.runtime.MessageSender;

function makeManualDeps(record: ReturnType<typeof vi.fn>): ManualRecordHandlerDeps {
  return {
    admit: vi.fn().mockResolvedValue({ settings: {} }),
    fetchContent: vi.fn().mockResolvedValue('fetched'),
    recordingPipeline: { record } as ManualRecordHandlerDeps['recordingPipeline'],
    setUrlContent: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSaveDeps(record: ReturnType<typeof vi.fn>): SaveRecordHandlerDeps {
  return {
    admit: vi.fn().mockResolvedValue({ settings: {} }),
    recordingPipeline: { record } as SaveRecordHandlerDeps['recordingPipeline'],
    setUrlContent: vi.fn().mockResolvedValue(undefined),
  };
}

describe('manual/preview handler claim ownership (PBI 2026-11-07-19)', () => {
  it('MANUAL_RECORD hands the claim to the orchestrator via the flag', async () => {
    const record = vi.fn().mockResolvedValue({ success: true });
    const handler = createManualRecordHandler(makeManualDeps(record));

    await handler(
      {
        type: 'MANUAL_RECORD',
        payload: { title: 'T', url: 'https://example.com/m', content: 'body' },
      } as ManualRecordMessage,
      EXTENSION_SENDER,
      vi.fn(),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/m' }),
      expect.objectContaining({ acquireRecoveryClaim: true }),
    );
  });

  it('PREVIEW_RECORD shares the same claim envelope with previewOnly in the request', async () => {
    const record = vi.fn().mockResolvedValue({ success: true });
    const handler = createManualRecordHandler(makeManualDeps(record));

    await handler(
      {
        type: 'PREVIEW_RECORD',
        payload: { title: 'T', url: 'https://example.com/p', content: 'body' },
      } as PreviewRecordMessage,
      EXTENSION_SENDER,
      vi.fn(),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/p', previewOnly: true }),
      expect.objectContaining({ acquireRecoveryClaim: true }),
    );
  });

  it('SAVE_RECORD stays flag-free (non-recovery paths keep the claim-free call)', async () => {
    const record = vi.fn().mockResolvedValue({ success: true });
    const handler = createSaveRecordHandler(makeSaveDeps(record));

    await handler(
      {
        type: 'SAVE_RECORD',
        payload: { title: 'T', url: 'https://example.com/s', content: 'body' },
      } as SaveRecordMessage,
      EXTENSION_SENDER,
      vi.fn(),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.anything(), { settings: {} });
  });

  it('recordingHandlers.ts no longer calls the claim store directly', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'recordingHandlers.ts'),
      'utf-8',
    );
    for (const banned of ['claimRecoveryOwner', 'releaseRecoveryOwner', 'getPendingPages']) {
      expect(source).not.toContain(banned);
    }
    expect(source).toContain('acquireRecoveryClaim: true');
  });
});
