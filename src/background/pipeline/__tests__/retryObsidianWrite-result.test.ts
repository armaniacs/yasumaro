import { describe, it, expect, vi } from 'vitest';
import { makeOrchestrator } from '../../__tests__/helpers/makeRecordingLogic.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { Settings } from '../../../utils/storage/types.js';

vi.mock('../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));

function mockObsidian() {
  return { appendToDailyNote: vi.fn().mockResolvedValue(undefined) };
}

const job = {
  title: 'Retry Page',
  url: 'https://retry-result.example.com/page',
  summary: 'Already summarized content',
  tags: ['news'],
};

describe('RecordingOrchestrator retry result reflects Obsidian outcome', () => {
  it('retryObsidianWrite returns true when the Obsidian write succeeds', async () => {
    const obsidian = mockObsidian();
    const pipeline = makeOrchestrator(
      () => Promise.resolve(null),
      obsidian,
      null,
      null,
      null,
      undefined,
      // No OBSIDIAN_ENABLED key: the step proceeds (only explicit false skips)
      async () => ({}) as unknown as Settings,
    );
    const result = await pipeline.retryObsidianWrite({ ...job });
    expect(result).toBe(true);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
  });

  it('retryObsidianWrite returns false when Obsidian is disabled (no write happened)', async () => {
    const obsidian = mockObsidian();
    const pipeline = makeOrchestrator(
      () => Promise.resolve(null),
      obsidian,
      null,
      null,
      null,
      undefined,
      async () => ({ [StorageKeys.OBSIDIAN_ENABLED]: false }) as unknown as Settings,
    );
    const result = await pipeline.retryObsidianWrite({ ...job });
    // Previously unconditionally true, which told the offline queue to drop
    // the job even though nothing was synced.
    expect(result).toBe(false);
    expect(obsidian.appendToDailyNote).not.toHaveBeenCalled();
  });

  it('deprecated retryObsidian mode reports failure when the write is skipped', async () => {
    const obsidian = mockObsidian();
    const pipeline = makeOrchestrator(
      () => Promise.resolve(null),
      obsidian,
      null,
      null,
      null,
      undefined,
      async () => ({ [StorageKeys.OBSIDIAN_ENABLED]: false }) as unknown as Settings,
    );
    const result = await pipeline.record(
      { title: job.title, url: job.url, summary: job.summary, tags: job.tags } as never,
      { mode: 'retryObsidian' },
    );
    expect(result.success).toBe(false);
  });
});
