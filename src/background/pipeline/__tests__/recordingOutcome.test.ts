/**
 * recordingOutcome.test.ts
 * The outcome policy (decideStepOutcome / finalizeSuccess) is driven through
 * the interface with in-memory fakes — no chrome stubs, no storage stubs.
 * The logger seam is module-mocked, as everywhere else in this codebase.
 */
import { vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));

import { decideStepOutcome, finalizeSuccess, type OutcomeAdapters } from '../recordingOutcome.js';
import { ErrorStrategy, type RecordingContext } from '../types.js';
import { PrivatePageError } from '../steps/checkPrivacyHeadersStep.js';
import { DuplicateError } from '../steps/checkDuplicateStep.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: { title: 'Test Page', url: 'https://example.com', content: 'content' },
    settings: {} as never,
    force: false,
    errors: [],
    ...overrides,
  };
}

function makeFakes(): OutcomeAdapters & {
  notifiedErrors: Array<{ title: string; message: string }>;
  notifiedSaves: string[];
  pendings: unknown[];
} {
  const notifiedErrors: Array<{ title: string; message: string }> = [];
  const notifiedSaves: string[] = [];
  const pendings: unknown[] = [];
  return {
    notifiedErrors,
    notifiedSaves,
    pendings,
    notifier: {
      notifyError: (title, message) => {
        notifiedErrors.push({ title, message });
      },
      notifySaveSuccess: (title) => {
        notifiedSaves.push(title);
      },
    },
    pending: {
      addPending: (entry) => {
        pendings.push(entry);
      },
    },
  };
}

describe('decideStepOutcome', () => {
  it('PrivatePage error returns a terminal result with no pending and no notice', () => {
    const fakes = makeFakes();
    const outcome = decideStepOutcome(
      new PrivatePageError('Private page detected', { reason: 'cache-control' }),
      { name: 'privacyHeaders', errorStrategy: ErrorStrategy.FATAL },
      makeContext(),
      fakes,
    );

    expect(outcome.done).toBe(true);
    if (!outcome.done) return;
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.reason).toBe('cache-control');
    expect(fakes.pendings).toHaveLength(0);
    expect(fakes.notifiedErrors).toHaveLength(0);
  });

  it('Duplicate error returns success+skipped with no pending and no notice', () => {
    const fakes = makeFakes();
    const outcome = decideStepOutcome(
      new DuplicateError('already-recorded'),
      { name: 'duplicate', errorStrategy: ErrorStrategy.FATAL },
      makeContext(),
      fakes,
    );

    expect(outcome.done).toBe(true);
    if (!outcome.done) return;
    expect(outcome.result).toMatchObject({ success: true, skipped: true, reason: 'already-recorded' });
    expect(fakes.pendings).toHaveLength(0);
    expect(fakes.notifiedErrors).toHaveLength(0);
  });

  it('FATAL error returns result + pending + notice as one atomic policy', () => {
    const fakes = makeFakes();
    const outcome = decideStepOutcome(
      new Error('network down'),
      { name: 'saveObsidian', errorStrategy: ErrorStrategy.FATAL },
      makeContext(),
      fakes,
    );

    expect(outcome.done).toBe(true);
    if (!outcome.done) return;
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toBe('network down');
    expect(fakes.pendings).toHaveLength(1);
    expect(fakes.pendings[0]).toMatchObject({
      url: 'https://example.com',
      title: 'Test Page',
      reason: 'pipeline-error',
      errorMessage: 'network down',
    });
    expect(fakes.notifiedErrors).toEqual([{ title: 'Test Page', message: 'network down' }]);
  });

  it('RETRY strategy is terminal with the same 3-set', () => {
    const fakes = makeFakes();
    const outcome = decideStepOutcome(
      new Error('ai timeout'),
      { name: 'privacyPipeline', errorStrategy: ErrorStrategy.RETRY },
      makeContext(),
      fakes,
    );

    expect(outcome.done).toBe(true);
    if (!outcome.done) return;
    expect(outcome.result.success).toBe(false);
    expect(fakes.pendings).toHaveLength(1);
    expect(fakes.notifiedErrors).toHaveLength(1);
  });

  it('BEST_EFFORT returns continue with a PipelineError carrying recoveryKind', () => {
    const fakes = makeFakes();
    const outcome = decideStepOutcome(
      new Error('sqlite busy'),
      { name: 'saveSqlite', errorStrategy: ErrorStrategy.BEST_EFFORT, offlineRetry: { jobKind: 'obsidian_sync' } },
      makeContext(),
      fakes,
    );

    expect(outcome.done).toBe(false);
    if (outcome.done) return;
    expect(outcome.pipelineError.step).toBe('saveSqlite');
    expect(outcome.pipelineError.recoveryKind).toBe('obsidian_sync');
    expect(fakes.pendings).toHaveLength(0);
    expect(fakes.notifiedErrors).toHaveLength(0);
  });
});

describe('finalizeSuccess', () => {
  it('clean context builds a pure shape with no pending and no notice', () => {
    const fakes = makeFakes();
    const result = finalizeSuccess(makeContext(), fakes);

    expect(result.success).toBe(true);
    expect(fakes.pendings).toHaveLength(0);
    expect(fakes.notifiedSaves).toHaveLength(0);
  });

  it('obsidian_sync error registers an obsidian-write-failed recovery entry', () => {
    const fakes = makeFakes();
    const result = finalizeSuccess(
      makeContext({
        errors: [{
          step: 'saveObsidian',
          error: new Error('obsidian unreachable'),
          strategy: ErrorStrategy.BEST_EFFORT,
          timestamp: Date.now(),
          recoveryKind: 'obsidian_sync',
          context: { url: 'https://example.com' },
        }],
      }),
      fakes,
    );

    expect(result.success).toBe(true);
    expect(fakes.pendings).toHaveLength(1);
    expect(fakes.pendings[0]).toMatchObject({ reason: 'obsidian-write-failed', errorMessage: 'obsidian unreachable' });
  });

  it('notifies save success only when obsidianDuration is present', () => {
    const fakes = makeFakes();
    finalizeSuccess(makeContext({ obsidianDuration: 12 } as Partial<RecordingContext>), fakes);
    expect(fakes.notifiedSaves).toEqual(['Test Page']);

    const fakes2 = makeFakes();
    finalizeSuccess(makeContext(), fakes2);
    expect(fakes2.notifiedSaves).toHaveLength(0);
  });
});
