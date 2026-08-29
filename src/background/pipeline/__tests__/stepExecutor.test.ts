import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StepExecutor } from '../stepExecutor.js';
import { ErrorStrategy } from '../types.js';
import type { PipelineStep, RecordingContext, StepDeps } from '../types.js';
import type { OfflineNetworkQueue } from '../../offlineNetworkQueue.js';

function makeContext(overrides?: Partial<RecordingContext>): RecordingContext {
  return {
    data: { url: 'https://example.com', title: 'Example', content: '' },
    traceId: 'trace-1',
    settings: {} as any,
    force: false,
    errors: [],
    ...overrides,
  } as RecordingContext;
}

describe('StepExecutor', () => {
  let queue: { enqueue: ReturnType<typeof vi.fn> };
  let executor: StepExecutor;

  beforeEach(() => {
    queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    executor = new StepExecutor(queue as unknown as OfflineNetworkQueue);
  });

  describe('executeWithStrategy', () => {
    it('returns context on immediate success', async () => {
      const step: PipelineStep = {
        name: 'ok',
        errorStrategy: ErrorStrategy.FATAL,
        execute: vi.fn().mockResolvedValue(makeContext({ data: { url: 'ok' } as any })),
      };
      const result = await executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps);
      expect(step.execute).toHaveBeenCalledTimes(1);
      expect(result.data.url).toBe('ok');
    });

    it('retries on RETRY strategy and then succeeds', async () => {
      const step: PipelineStep = {
        name: 'retry-ok',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 2,
        execute: vi.fn()
          .mockRejectedValueOnce(new Error('transient'))
          .mockResolvedValue(makeContext()),
      };
      const result = await executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps);
      expect(step.execute).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it('exhausts retries and throws when no offline queue configured', async () => {
      const localExecutor = new StepExecutor(null);
      const step: PipelineStep = {
        name: 'retry-fail',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        execute: vi.fn().mockRejectedValue(new Error('persistent')),
      };
      await expect(
        localExecutor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('persistent');
      expect(step.execute).toHaveBeenCalledTimes(2); // initial + 1 retry
    });

    it('enqueues offline job after retry exhaustion on network error', async () => {
      const step: PipelineStep = {
        name: 'offline-ai',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        offlineRetry: { jobKind: 'ai_summary' },
        execute: vi.fn().mockRejectedValue(new Error('network timeout')),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('network timeout');
      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ai_summary' }),
      );
    });

    it('does not enqueue offline job when error is not network-related', async () => {
      const step: PipelineStep = {
        name: 'logic-error',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        offlineRetry: { jobKind: 'obsidian_sync' },
        execute: vi.fn().mockRejectedValue(new Error('null pointer')),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('null pointer');
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('does not enqueue offline job when offlineRetry is absent', async () => {
      const step: PipelineStep = {
        name: 'no-offline',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        execute: vi.fn().mockRejectedValue(new Error('fetch failed')),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('fetch failed');
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('does not retry when strategy is FATAL', async () => {
      const step: PipelineStep = {
        name: 'fatal',
        errorStrategy: ErrorStrategy.FATAL,
        execute: vi.fn().mockRejectedValue(new Error('boom')),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('boom');
      expect(step.execute).toHaveBeenCalledTimes(1);
    });

    it('handles retry with zero maxRetries', async () => {
      const step: PipelineStep = {
        name: 'zero-retries',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 0,
        execute: vi.fn().mockRejectedValue(new Error('instant fail')),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('instant fail');
      expect(step.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('enqueueOfflineJob', () => {
    it('returns early when offlineRetry is absent', async () => {
      const step: PipelineStep = {
        name: 'no-offline',
        errorStrategy: ErrorStrategy.FATAL,
        execute: vi.fn().mockResolvedValue(makeContext()),
      };
      // access private method for coverage
      await (executor as any).enqueueOfflineJob(step, makeContext());
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('logs error when enqueue itself fails', async () => {
      queue.enqueue.mockRejectedValue(new Error('queue full'));
      const step: PipelineStep = {
        name: 'enqueue-fail',
        errorStrategy: ErrorStrategy.FATAL,
        offlineRetry: { jobKind: 'ai_summary' },
        execute: vi.fn().mockResolvedValue(makeContext()),
      };
      await (executor as any).enqueueOfflineJob(step, makeContext());
      expect(queue.enqueue).toHaveBeenCalled();
    });
  });

  describe('network error detection', () => {
    it('treats timeout as network error', async () => {
      const step: PipelineStep = {
        name: 'timeout',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        offlineRetry: { jobKind: 'ai_summary' },
        execute: vi.fn().mockRejectedValue(new Error('request timeout')),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('timeout');
      expect(queue.enqueue).toHaveBeenCalled();
    });

    it('treats generic string as non-network when irrelevant', async () => {
      const step: PipelineStep = {
        name: 'syntax',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        offlineRetry: { jobKind: 'ai_summary' },
        execute: vi.fn().mockRejectedValue('syntax error'),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('syntax error');
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('inspects error.cause recursively', async () => {
      const cause = new Error('connection refused');
      const error = new Error('wrapped');
      (error as any).cause = cause;
      const step: PipelineStep = {
        name: 'recursive-cause',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        offlineRetry: { jobKind: 'obsidian_sync' },
        execute: vi.fn().mockRejectedValue(error),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('wrapped');
      expect(queue.enqueue).toHaveBeenCalled();
    });

    it('treats null error as non-network', async () => {
      const step: PipelineStep = {
        name: 'null-err',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        offlineRetry: { jobKind: 'ai_summary' },
        execute: vi.fn().mockRejectedValue(null),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toBeNull();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('treats AI-related message as network error', async () => {
      const step: PipelineStep = {
        name: 'ai-fail',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 1,
        offlineRetry: { jobKind: 'ai_summary' },
        execute: vi.fn().mockRejectedValue(new Error('AI service unavailable')),
      };
      await expect(
        executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
      ).rejects.toThrow('AI service unavailable');
      expect(queue.enqueue).toHaveBeenCalled();
    });
  });
});
