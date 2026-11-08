/**
 * offlineQueueProcessor-claimRetry.test.ts — PBI 2026-11-08-07(4).
 *
 * A job skipped because another owner holds the recovery claim must not burn
 * a retry: contention is not a send failure. The job stays queued with its
 * retryCount untouched instead of sliding toward max-retries exhaustion and
 * a spurious terminal handover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOfflineQueueProcessor } from '../offlineQueueProcessor.js';
import { createOfflineNetworkQueue, type OfflineJob } from '../offlineNetworkQueue.js';
import { InMemoryAdapter } from '../persistentRetryQueue.js';
import { claimRecoveryOwner, releaseRecoveryOwner } from '../../utils/recoveryClaimStore.js';

const CLAIMS_KEY = 'recording_recovery_claims';
const URL = 'https://example.com/contended';

function makeProcessor(opts: {
  queue: ReturnType<typeof createOfflineNetworkQueue>;
  record: ReturnType<typeof vi.fn>;
  handOver: ReturnType<typeof vi.fn>;
}): ReturnType<typeof createOfflineQueueProcessor> {
  return createOfflineQueueProcessor({
    offlineNetworkQueue: opts.queue,
    recordingPipeline: {
      record: opts.record,
      retryObsidianWrite: vi.fn().mockResolvedValue(true),
    },
    isConsentGranted: () => Promise.resolve(true),
    terminalFailureHandler: { handOver: opts.handOver },
  });
}

describe('createOfflineQueueProcessor', () => {
  describe('claim contention does not consume retries', () => {
    beforeEach(async () => {
      await global.chrome.storage.local.remove(CLAIMS_KEY);
      vi.clearAllMocks();
    });

    it('keeps a contended job queued with its retryCount untouched and hands nothing over', async () => {
      const queue = createOfflineNetworkQueue(new InMemoryAdapter());
      await queue.enqueue({
        type: 'ai_summary',
        payload: { title: 't', url: URL, content: 'c' },
      });
      // Another owner (manual re-run) holds the durable claim now.
      expect(await claimRecoveryOwner(URL, 'manual')).toBe(true);

      const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
      const handOver = vi.fn().mockResolvedValue(undefined);
      await makeProcessor({ queue, record, handOver })();

      expect(record).not.toHaveBeenCalled();
      expect(handOver).not.toHaveBeenCalled();
      expect(await queue.getQueueSize()).toBe(1);
      const kept = await queue.peek();
      expect((kept as OfflineJob).retryCount).toBe(0);
    });

    it('processes the same job normally once the conflicting claim is released', async () => {
      const queue = createOfflineNetworkQueue(new InMemoryAdapter());
      await queue.enqueue({
        type: 'ai_summary',
        payload: { title: 't', url: URL, content: 'c' },
      });
      expect(await claimRecoveryOwner(URL, 'manual')).toBe(true);

      const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
      const handOver = vi.fn().mockResolvedValue(undefined);
      const processQueue = makeProcessor({ queue, record, handOver });

      await processQueue();
      expect(record).not.toHaveBeenCalled();

      await releaseRecoveryOwner(URL, 'manual');
      await processQueue();

      expect(record).toHaveBeenCalledTimes(1);
      expect(handOver).not.toHaveBeenCalled();
      expect(await queue.getQueueSize()).toBe(0);
    });
  });
});
