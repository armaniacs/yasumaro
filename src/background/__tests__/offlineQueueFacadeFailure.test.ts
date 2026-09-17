/**
 * offlineQueueFacadeFailure.test.ts
 * Pins the PBI-15 failure-propagation contract at the OfflineNetworkQueue
 * facade and StepExecutor layers (Red/Blue/Ops/Code-Quality findings on
 * 0917a): a persisted-save failure must surface as false + ERROR, never as
 * an unconditional success INFO; dequeue/peek must fail closed (null) when
 * the in-lock mutate could not persist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

import { addLog } from '../../utils/logger.js';
import {
  OfflineNetworkQueue,
  type OfflineJob,
  type QueuePort,
} from '../offlineNetworkQueue.js';
import { StepExecutor } from '../pipeline/stepExecutor.js';
import { ErrorStrategy, type PipelineStep, type RecordingContext, type StepDeps } from '../pipeline/types.js';

function makeJob(url: string): OfflineJob {
  return { id: `id-${url}`, type: 'ai_summary', payload: { url }, createdAt: Date.now(), retryCount: 0 };
}

function messagesOf(type: string): string[] {
  return (addLog as ReturnType<typeof vi.fn>).mock.calls
    .filter(([t]) => t === type)
    .map(([, message]) => String(message));
}

/** Scripted port: in-memory list with independent enqueue/mutate failure switches. */
function makePort(seed: OfflineJob[] = []): QueuePort<OfflineJob> & { items: OfflineJob[]; failEnqueue: boolean; failMutate: boolean } {
  return {
    items: [...seed],
    failEnqueue: false,
    failMutate: false,
    async enqueue(item: OfflineJob): Promise<boolean> {
      if (this.failEnqueue) return false;
      this.items.push(item);
      return true;
    },
    async load(): Promise<OfflineJob[]> {
      return [...this.items];
    },
    async save(items: OfflineJob[]): Promise<void> {
      this.items = [...items];
    },
    async flush(handler: (item: OfflineJob) => Promise<boolean>): Promise<OfflineJob[]> {
      return [];
    },
    async getQueueSize(): Promise<number> {
      return this.items.length;
    },
    filterExpiredAndOverRetry(items: OfflineJob[]): { kept: OfflineJob[]; dropped: OfflineJob[] } {
      return { kept: [...items], dropped: [] };
    },
    async mutate(fn: (items: OfflineJob[]) => OfflineJob[] | Promise<OfflineJob[]>): Promise<boolean> {
      // Run the caller's transform against a copy, then either commit or drop
      // the result depending on the failure switch (mirrors a save failure).
      const next = await fn([...this.items]);
      if (this.failMutate) return false;
      this.items = [...next];
      return true;
    },
  };
}

describe('OfflineNetworkQueue failure propagation (PBI-15 facade)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueue returns true and logs INFO success when the port persists', async () => {
    const queue = new OfflineNetworkQueue(makePort());

    await expect(queue.enqueue({ type: 'ai_summary', payload: { url: 'https://example.com' } })).resolves.toBe(true);

    expect(messagesOf('INFO').some((m) => m.includes('OfflineNetworkQueue: enqueued job'))).toBe(true);
    expect(messagesOf('ERROR')).toHaveLength(0);
  });

  it('enqueue returns false and logs ERROR (no success INFO) when the port drops the job', async () => {
    const port = makePort();
    port.failEnqueue = true;
    const queue = new OfflineNetworkQueue(port);

    await expect(queue.enqueue({ type: 'ai_summary', payload: { url: 'https://example.com' } })).resolves.toBe(false);

    expect(messagesOf('ERROR').some((m) => m.includes('OfflineNetworkQueue: failed to enqueue job'))).toBe(true);
    expect(messagesOf('INFO').some((m) => m.includes('enqueued job'))).toBe(false);
  });

  it('dequeue fails closed (null + WARN) when the mutate could not persist', async () => {
    const port = makePort([makeJob('https://a.example.com')]);
    port.failMutate = true;
    const queue = new OfflineNetworkQueue(port);

    await expect(queue.dequeue()).resolves.toBeNull();

    expect(messagesOf('WARN').some((m) => m.includes('dequeue not persisted'))).toBe(true);
    // Storage snapshot untouched: the job stays queued for the next cycle.
    expect(port.items).toHaveLength(1);
  });

  it('dequeue still takes the job when the mutate persists', async () => {
    const queue = new OfflineNetworkQueue(makePort([makeJob('https://a.example.com')]));

    const job = await queue.dequeue();

    expect(job?.payload).toEqual({ url: 'https://a.example.com' });
  });

  it('peek reports null + WARN when the mutate could not persist', async () => {
    const port = makePort([makeJob('https://a.example.com')]);
    port.failMutate = true;
    const queue = new OfflineNetworkQueue(port);

    await expect(queue.peek()).resolves.toBeNull();

    expect(messagesOf('WARN').some((m) => m.includes('peek not persisted'))).toBe(true);
  });
});

describe('StepExecutor offline-enqueue failure visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeContext(): RecordingContext {
    return {
      data: { url: 'https://example.com', title: 'Example', content: '' },
      traceId: 'trace-1',
      settings: {},
      force: false,
      errors: [],
    } as RecordingContext;
  }

  function failingStep(): PipelineStep {
    return {
      name: 'offline-ai',
      errorStrategy: ErrorStrategy.FATAL,
      offlineRetry: { jobKind: 'ai_summary' },
      execute: vi.fn().mockResolvedValue(makeContext()),
    };
  }

  it('logs ERROR (no success INFO) when the queue reports false', async () => {
    const port = makePort();
    port.failEnqueue = true;
    const executor = new StepExecutor(new OfflineNetworkQueue(port));

    await (executor as unknown as { enqueueOfflineJob(step: PipelineStep, context: RecordingContext): Promise<void> }).enqueueOfflineJob(
      failingStep(),
      makeContext(),
    );

    expect(messagesOf('ERROR').some((m) => m.includes('failed to enqueue offline job'))).toBe(true);
    expect(messagesOf('INFO').some((m) => m.includes('queued offline job'))).toBe(false);
  });

  it('logs INFO success when the queue persists', async () => {
    const executor = new StepExecutor(new OfflineNetworkQueue(makePort()));

    await (executor as unknown as { enqueueOfflineJob(step: PipelineStep, context: RecordingContext): Promise<void> }).enqueueOfflineJob(
      failingStep(),
      makeContext(),
    );

    expect(messagesOf('INFO').some((m) => m.includes('queued offline job'))).toBe(true);
  });

  it('still surfaces the original error when enqueue throws', async () => {
    const throwingQueue = { enqueue: vi.fn().mockRejectedValue(new Error('I/O torn down')) };
    const executor = new StepExecutor(throwingQueue as unknown as OfflineNetworkQueue);
    const step: PipelineStep = {
      name: 'offline-ai',
      errorStrategy: ErrorStrategy.RETRY,
      maxRetries: 0,
      offlineRetry: { jobKind: 'ai_summary' },
      execute: vi.fn().mockRejectedValue(new Error('network timeout')),
    };

    await expect(
      executor.executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps),
    ).rejects.toThrow('network timeout');
    expect(messagesOf('ERROR').some((m) => m.includes('failed to enqueue offline job'))).toBe(true);
  });
});
