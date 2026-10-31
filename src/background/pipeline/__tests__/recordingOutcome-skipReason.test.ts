/**
 * recordingOutcome-skipReason.test.ts
 *
 * decideStepOutcome() 理由分岐の網羅（PBI 2026-10-31-01）: every terminal
 * branch of the outcome policy records the latest skip reason, and the
 * BEST_EFFORT continue path records none (the pipeline may still succeed).
 *
 * The skip recorder is an injectable adapter like notifier / pending: tests
 * use an in-memory fake and assert the payload is the reason code ONLY —
 * never a URL, a title, or content (軸3「収集を増やさない」).
 */
import { vi } from 'vitest';

vi.mock('../../../utils/logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    logError: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../../utils/logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    logError: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../../utils/logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    logError: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);

import { decideStepOutcome, finalizeSuccess } from '../recordingOutcome.js';
import type { OutcomeAdapters } from '../recordingOutcome.js';
import { ErrorStrategy, type RecordingContext } from '../types.js';
import { PrivatePageError } from '../steps/checkPrivacyHeadersStep.js';
import { DuplicateError } from '../steps/checkDuplicateStep.js';
import { RegenerateUpdateError } from '../steps/saveSqliteStep.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: { title: 'Test Page', url: 'https://example.com', content: 'content' },
    settings: {} as never,
    force: false,
    errors: [],
    ...overrides,
  };
}

function makeFakes(): OutcomeAdapters & { skips: string[] } {
  const skips: string[] = [];
  const adapters: OutcomeAdapters = {
    notifier: {
      notifyError: () => undefined,
      notifySaveSuccess: () => undefined,
    },
    pending: {
      addPending: () => undefined,
    },
    // PBI 2026-10-31-01: the skip-reason recorder rides the same adapter seam.
    skipRecorder: {
      recordSkip: (reason: string) => {
        skips.push(reason);
      },
    },
  };
  return { ...adapters, skips };
}

describe('decideStepOutcome — skip reason branches (PBI 2026-10-31-01)', () => {
  it('PrivatePage error records the private-page skip reason only', () => {
    const fakes = makeFakes();
    decideStepOutcome(
      new PrivatePageError('Private page detected', { reason: 'cache-control' }),
      { name: 'privacyHeaders', errorStrategy: ErrorStrategy.FATAL },
      makeContext(),
      fakes,
    );

    expect(fakes.skips).toEqual(['private-page']);
  });

  it('Duplicate error records the duplicate skip reason only', () => {
    const fakes = makeFakes();
    decideStepOutcome(
      new DuplicateError('already-recorded'),
      { name: 'duplicate', errorStrategy: ErrorStrategy.FATAL },
      makeContext(),
      fakes,
    );

    expect(fakes.skips).toEqual(['duplicate']);
  });

  it('RegenerateUpdateError records the pipeline-error skip reason', () => {
    const fakes = makeFakes();
    decideStepOutcome(
      new RegenerateUpdateError('SQLite regenerate update failed for id=7'),
      { name: 'saveSqlite', errorStrategy: ErrorStrategy.BEST_EFFORT },
      makeContext(),
      fakes,
    );

    expect(fakes.skips).toEqual(['pipeline-error']);
  });

  it('FATAL error records the pipeline-error skip reason', () => {
    const fakes = makeFakes();
    decideStepOutcome(
      new Error('network down'),
      { name: 'saveObsidian', errorStrategy: ErrorStrategy.FATAL },
      makeContext(),
      fakes,
    );

    expect(fakes.skips).toEqual(['pipeline-error']);
  });

  it('RETRY error records the pipeline-error skip reason', () => {
    const fakes = makeFakes();
    decideStepOutcome(
      new Error('ai timeout'),
      { name: 'privacyPipeline', errorStrategy: ErrorStrategy.RETRY },
      makeContext(),
      fakes,
    );

    expect(fakes.skips).toEqual(['pipeline-error']);
  });

  it('BEST_EFFORT continue path records NO skip reason (the recording may still succeed)', () => {
    const fakes = makeFakes();
    decideStepOutcome(
      new Error('sqlite busy'),
      { name: 'saveSqlite', errorStrategy: ErrorStrategy.BEST_EFFORT, offlineRetry: { jobKind: 'obsidian_sync' } },
      makeContext(),
      fakes,
    );

    expect(fakes.skips).toEqual([]);
  });

  it('the recorded payload is the reason code only — no URL, title, or content', () => {
    const fakes = makeFakes();
    decideStepOutcome(
      new DuplicateError('already-recorded'),
      { name: 'duplicate', errorStrategy: ErrorStrategy.FATAL },
      makeContext(),
      fakes,
    );

    expect(fakes.skips).toHaveLength(1);
    expect(fakes.skips[0]).toBe('duplicate');
    expect(fakes.skips[0]).not.toContain('https://example.com');
    expect(fakes.skips[0]).not.toContain('Test Page');
    expect(fakes.skips[0]).not.toContain('content');
  });
});

describe('finalizeSuccess — skip reason (PBI 2026-10-31-01)', () => {
  it('a successful recording records NO skip reason', () => {
    const fakes = makeFakes();
    finalizeSuccess(makeContext(), fakes);

    expect(fakes.skips).toEqual([]);
  });
});
