// @vitest-environment jsdom
/**
 * opfsWorker-loadShedRetry.test.ts
 * PBI 2026-10-16-05: a full request queue waits with a bounded retry budget
 * instead of shedding immediately. Draining is driven by test-controlled
 * gates (Promise.withResolvers), the retry clock is injected — no real-time
 * waits anywhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';
import {
  enqueue,
  __setShedSleepForTesting,
  __setMaxQueuedRequestsForTesting,
  __resetQueueForTesting,
} from '../opfsWorker.js';
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  WorkerLogMessage,
} from '../opfsWorker/types.js';

type PostedMessage = WorkerResponseMessage | WorkerLogMessage;

function isLogMessage(message: PostedMessage): message is WorkerLogMessage {
  return '__log' in message;
}

function makeRequest(id: number): WorkerRequestMessage {
  return { id, type: 'HEALTH_CHECK', payload: undefined };
}

interface GatedTask {
  task: () => Promise<void>;
  run: ReturnType<typeof vi.fn<() => Promise<void>>>;
  release: () => void;
}

function createGatedTask(): GatedTask {
  const gate = Promise.withResolvers<void>();
  const run = vi.fn<() => Promise<void>>(async () => {
    await gate.promise;
  });
  return { task: run, run, release: () => gate.resolve() };
}

describe('opfsWorker', () => {
  describe('enqueue', () => {
    const posted: PostedMessage[] = [];

    beforeEach(() => {
      posted.length = 0;
      __resetQueueForTesting();
      vi.spyOn(self, 'postMessage').mockImplementation(
        ((message: PostedMessage) => {
          posted.push(message);
        }) as typeof self.postMessage,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      __resetQueueForTesting();
    });

    it('absorbs a burst when a slot frees within the retry budget', async () => {
      __setMaxQueuedRequestsForTesting(2);
      const blocker = createGatedTask();
      const waiting = createGatedTask();
      const filling = createGatedTask();
      // The retry clock frees the head task, so the drain loop advances
      // exactly one slot during the first wait.
      const sleepMock = vi.fn<(ms: number) => Promise<void>>(async () => {
        blocker.release();
      });
      __setShedSleepForTesting(sleepMock);

      await enqueue(blocker.task, makeRequest(1));
      await enqueue(waiting.task, makeRequest(2));
      await enqueue(filling.task, makeRequest(3));

      const absorbed = createGatedTask();
      await enqueue(absorbed.task, makeRequest(4));

      // Bounded waits happened (freeing a gate shrinks the queue only after
      // the drain loop advances, so more than one wait can elapse), the
      // budget was not exhausted, and nothing was shed.
      expect(sleepMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(sleepMock.mock.calls.length).toBeLessThanOrEqual(3);
      expect(posted).toHaveLength(0);

      // The absorbed request is really processed once the burst drains.
      waiting.release();
      filling.release();
      await waitForMock(() => expect(absorbed.run).toHaveBeenCalled());
      absorbed.release();
    });

    it('sheds with an explicit retry-exhausted failure when overload persists', async () => {
      __setMaxQueuedRequestsForTesting(2);
      const sleepMock = vi.fn<(ms: number) => Promise<void>>(async () => {});
      __setShedSleepForTesting(sleepMock);

      const blocker = createGatedTask();
      const waiting = createGatedTask();
      const filling = createGatedTask();
      await enqueue(blocker.task, makeRequest(1));
      await enqueue(waiting.task, makeRequest(2));
      await enqueue(filling.task, makeRequest(3));

      // Nothing drains during the waits, so the budget must run out.
      const shed = createGatedTask();
      await enqueue(shed.task, makeRequest(4));

      // Guard: the retry loop is bounded (mirrors MAX_SHED_RETRIES = 3),
      // every wait carries a finite delay, and the shed task never runs.
      expect(sleepMock).toHaveBeenCalledTimes(3);
      for (const [delayMs] of sleepMock.mock.calls) {
        expect(Number.isFinite(delayMs)).toBe(true);
      }
      expect(shed.run).not.toHaveBeenCalled();

      const responses = posted.filter(
        (message): message is WorkerResponseMessage => !isLogMessage(message),
      );
      expect(responses).toHaveLength(1);
      expect(responses[0]).toMatchObject({ id: 4, success: false });
      expect(responses[0]?.error ?? '').toContain('retries');

      const logs = posted.filter(isLogMessage);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ __log: true, level: 'warn' });
      expect(logs[0]?.message ?? '').toContain('shedding');

      blocker.release();
      waiting.release();
      filling.release();
      await waitForMock(() => expect(filling.run).toHaveBeenCalled());
    });

    it('enqueues without any wait on the normal uncongested path', async () => {
      const sleepMock = vi.fn<(ms: number) => Promise<void>>(async () => {});
      __setShedSleepForTesting(sleepMock);

      const normal = createGatedTask();
      await enqueue(normal.task, makeRequest(9));

      expect(sleepMock).not.toHaveBeenCalled();
      expect(posted).toHaveLength(0);
      normal.release();
      await waitForMock(() => expect(normal.run).toHaveBeenCalled());
    });
  });
});
