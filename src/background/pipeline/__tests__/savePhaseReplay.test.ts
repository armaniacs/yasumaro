/**
 * savePhaseReplay.test.ts
 *
 * Pins the replay write-visibility policy at the SavePhase seam: a retry
 * context reaches the Obsidian collaborator as an idempotent (dedupe) write,
 * and a normal context reaches it without any dedupe option. The fake
 * collaborator records the append arguments it receives.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger/core.js', () => ({ addLog: vi.fn(), logError: vi.fn() }));
vi.mock('../../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../utils/logger/api.js', () => ({ addLog: vi.fn(), logError: vi.fn() }));

import type { RecordingContext, StepDeps } from '../types.js';
import type { Settings } from '../../../utils/storage/types.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { createRetryContext, createStepDeps } from '../contextBuilder.js';
import { createSavePhase, type SavePhaseEnv } from '../savePhase.js';
import { makeOrchestrator } from '../../__tests__/helpers/makeRecordingLogic.js';

const replaySettings = { [StorageKeys.LEGACY_DUAL_WRITE_ENABLED]: false } as Settings;

function makeObsidian() {
  return {
    appendToDailyNote: vi.fn<(content: string, traceId?: string, options?: { dedupe?: boolean }) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

function makeEnv(): SavePhaseEnv {
  const adapters = {
    notifier: { notifyError: vi.fn(), notifySaveSuccess: vi.fn() },
    pending: { addPending: vi.fn() },
  };
  // Direct step execution: the policy under test is the write-visibility
  // mapping, not the executor's retry/offline layer.
  return {
    executor: { executeWithStrategy: (step, ctx, deps) => step.execute(ctx, deps) },
    outcomeAdapters: adapters,
  };
}

function makeDeps(obsidian: unknown): StepDeps {
  return createStepDeps({ obsidian: obsidian as never, aiService: {} as never, sqliteClient: null });
}

function makeNormalContext(): RecordingContext {
  return {
    data: { title: 'Save Test', url: 'https://example.com/normal', content: 'page body' },
    settings: replaySettings,
    force: false,
    traceId: 'trace-normal-1',
    errors: [],
    markdown: '## Save Test\n\npage body',
  } as RecordingContext;
}

function makeRetryContext(): RecordingContext {
  return createRetryContext(
    {
      title: 'Retry Page',
      url: 'https://example.com/replay',
      summary: 'Already summarized content',
      tags: ['news'],
      markdown: '- [Retry Page](https://example.com/replay)\n\t- Already summarized content #news',
    },
    replaySettings,
    'trace-replay-1',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SavePhase replay write-visibility (dedupe policy at the seam)', () => {
  it('Scenario: retry context reaches the collaborator as an idempotent (dedupe) write', async () => {
    const phase = createSavePhase(makeEnv());
    const obsidian = makeObsidian();
    const context = makeRetryContext();

    const receipt = await phase.save(context, makeDeps(obsidian));

    expect(receipt.terminated).toBe(false);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledWith(
      context.markdown,
      'trace-replay-1',
      { dedupe: true },
    );
  });

  it('Scenario: normal context writes unconditionally (no dedupe option smuggled in)', async () => {
    const phase = createSavePhase(makeEnv());
    const obsidian = makeObsidian();
    const context = makeNormalContext();

    const receipt = await phase.save(context, makeDeps(obsidian));

    expect(receipt.terminated).toBe(false);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
    // Exactly two args: the write options object is never passed for a
    // normal write, so the section editor keeps unconditional insertion.
    const call = obsidian.appendToDailyNote.mock.calls[0] ?? [];
    expect(call).toHaveLength(2);
    expect(call[0]).toBe('## Save Test\n\npage body');
    expect(call[1]).toBe('trace-normal-1');
  });

  it('createRetryContext marks the retry context as a replay write', () => {
    const context = createRetryContext(
      { title: 'T', url: 'https://example.com/replay', summary: 'sum' },
      replaySettings,
    );
    expect(context.replayWrite).toBe(true);
  });
});

describe('retryObsidianWrite end-to-end write visibility', () => {
  it('reaches the Obsidian client with dedupe (no AI re-run)', async () => {
    const obsidian = makeObsidian();
    const pipeline = makeOrchestrator(
      () => Promise.resolve(null),
      obsidian,
      null,
      null,
      null,
      undefined,
      async () => ({}) as unknown as Settings,
    );

    const result = await pipeline.retryObsidianWrite({
      title: 'Retry Page',
      url: 'https://replay-e2e.example.com/page',
      summary: 'Already summarized content',
      tags: ['news'],
    });

    expect(result).toBe(true);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { dedupe: true },
    );
  });
});
