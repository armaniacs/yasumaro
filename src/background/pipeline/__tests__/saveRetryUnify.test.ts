/**
 * saveRetryUnify.test.ts (PBI 2026-10-16-09: retry経路のSavePhase統一)
 *
 * BDD Scenario 1: retryがReceiptで判定される
 *   Given 再試行 / When 実行する / Then SaveReceipt/outcomesで成功が決まる
 * BDD Scenario 2: 3旗が1型に束ねられる
 *   Given RetryContext / When stepsが参照する / Then 3旗の個別参照が残らない
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../../utils/logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    logError: 'fn',
  }),
);
vi.mock('../../../utils/logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    logError: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
    ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
  }),
);
vi.mock('../../../utils/logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    logError: 'fn',
  }),
);

import type { RecordingContext, StepDeps } from '../types.js';
import type { Settings } from '../../../utils/storage/types.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { createRetryContext, createStepDeps } from '../contextBuilder.js';
import { createSavePhase, type SavePhaseEnv } from '../savePhase.js';
import { StepExecutor } from '../stepExecutor.js';
import { noStepDelay } from '../../__tests__/helpers/makeRecordingLogic.js';

const retrySettings = { [StorageKeys.LEGACY_DUAL_WRITE_ENABLED]: false } as Settings;

function makeObsidian() {
  return {
    appendToDailyNote: vi.fn<(content: string, traceId?: string, options?: { dedupe?: boolean }) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

function makeEnv(): SavePhaseEnv {
  return {
    // Unified driver: the same StepExecutor seam the normal save() path uses.
    executor: new StepExecutor(null, undefined, noStepDelay),
    outcomeAdapters: {
      notifier: { notifyError: vi.fn(), notifySaveSuccess: vi.fn() },
      pending: { addPending: vi.fn() },
    },
  };
}

function makeDeps(obsidian: unknown): StepDeps {
  return createStepDeps({ obsidian: obsidian as never, aiService: null as never, sqliteClient: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RetryContext bundles the 3 retry-write flags (BDD Scenario 2)', () => {
  it('exposes one retry bundle carrying replayWrite + dedupe + frozen markdown', () => {
    const frozen = '- [T](https://example.com)\n  - sum';
    const ctx = createRetryContext(
      { title: 'T', url: 'https://example.com', summary: 'sum', tags: ['a'], markdown: frozen },
      retrySettings,
      'trace-1',
    );
    expect(ctx.retry).toEqual({ replayWrite: true, dedupe: true, markdown: frozen });
  });

  it('derives the context fields from the single bundle (no independent flags)', () => {
    const frozen = '- [T](https://example.com)\n  - sum';
    const ctx = createRetryContext(
      { title: 'T', url: 'https://example.com', summary: 'sum', markdown: frozen },
      retrySettings,
    );
    expect(ctx.replayWrite).toBe(ctx.retry.replayWrite);
    expect(ctx.markdown).toBe(ctx.retry.markdown);
  });

  it('legacy payload without frozen markdown carries an empty markdown slot in the bundle', () => {
    const ctx = createRetryContext(
      { title: 'T', url: 'https://example.com', summary: 'sum' },
      retrySettings,
    );
    expect(ctx.retry.replayWrite).toBe(true);
    expect(ctx.retry.dedupe).toBe(true);
    expect(ctx.retry.markdown).toBeUndefined();
    expect(ctx.markdown).toBeUndefined();
  });
});

describe('saveRetry runs the retry subset through the SavePhase seam (BDD Scenario 1)', () => {
  it('returns a SaveReceipt with the saveObsidian outcome on success', async () => {
    const phase = createSavePhase(makeEnv());
    const obsidian = makeObsidian();
    const ctx = createRetryContext(
      {
        title: 'Retry Page',
        url: 'https://example.com/replay',
        summary: 'Already summarized content',
        tags: ['news'],
        markdown: '- [Retry Page](https://example.com/replay)\n\t- Already summarized content #news',
      },
      retrySettings,
      'trace-replay-1',
    );

    const receipt = await phase.saveRetry(ctx, makeDeps(obsidian));

    expect(receipt.terminated).toBe(false);
    if (receipt.terminated) return;
    expect(receipt.outcomes).toEqual([{ name: 'saveObsidian', status: 'ok' }]);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledWith(
      ctx.markdown,
      'trace-replay-1',
      { dedupe: true },
    );
  });

  it('regenerates markdown through the format head for legacy payloads (no AI re-run)', async () => {
    const phase = createSavePhase(makeEnv());
    const obsidian = makeObsidian();
    const ctx = createRetryContext(
      { title: 'Retry Page', url: 'https://example.com/legacy', summary: 'Already summarized content', tags: ['news'] },
      retrySettings,
      'trace-legacy-1',
    );

    const receipt = await phase.saveRetry(ctx, makeDeps(obsidian));

    expect(receipt.terminated).toBe(false);
    if (receipt.terminated) return;
    expect(receipt.outcomes).toEqual([{ name: 'saveObsidian', status: 'ok' }]);
    expect(receipt.context.markdown).toContain('Retry Page');
    expect(obsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
  });

  it('records a skipped outcome (not ok) when nothing was written — Receipt decides, not the caller', async () => {
    const phase = createSavePhase(makeEnv());
    const obsidian = makeObsidian();
    const disabled = { [StorageKeys.OBSIDIAN_ENABLED]: false } as Settings;
    const ctx = createRetryContext(
      { title: 'T', url: 'https://example.com/off', summary: 'sum' },
      disabled,
      'trace-off-1',
    );

    const receipt = await phase.saveRetry(ctx, makeDeps(obsidian));

    expect(receipt.terminated).toBe(false);
    if (receipt.terminated) return;
    expect(receipt.outcomes).toEqual([
      { name: 'saveObsidian', status: 'skipped', reason: 'no-write' },
    ]);
    expect(obsidian.appendToDailyNote).not.toHaveBeenCalled();
  });

  it('propagates the Obsidian failure (parity with the former hand loop)', async () => {
    const phase = createSavePhase(makeEnv());
    const obsidian = makeObsidian();
    obsidian.appendToDailyNote.mockRejectedValueOnce(new Error('network down'));
    const ctx = createRetryContext(
      { title: 'T', url: 'https://example.com/fail', summary: 'sum' },
      retrySettings,
    );

    await expect(phase.saveRetry(ctx, makeDeps(obsidian))).rejects.toThrow('network down');
  });
});

describe('retry path references the bundle, not individual flags (BDD Scenario 2)', () => {
  it('RecordingOrchestrator.retryObsidianWrite reads no individual retry flag', () => {
    const source = readFileSync(new URL('../RecordingOrchestrator.ts', import.meta.url), 'utf8');
    for (const flag of ['replayWrite', 'dedupe', 'obsidianDuration', 'executeRetrySubset', 'retrySteps']) {
      expect(source, `orchestrator must not reference ${flag}`).not.toContain(flag);
    }
  });

  it('retryObsidianWrite returns true/false from the receipt via the public entry point', async () => {
    const { makeOrchestrator } = await import('../../__tests__/helpers/makeRecordingLogic.js');
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
    const ok = await pipeline.retryObsidianWrite({
      title: 'T',
      url: 'https://example.com/unify',
      summary: 'sum',
      markdown: '- [T](https://example.com/unify)\n  - sum',
    });
    expect(ok).toBe(true);
    expect(obsidian.appendToDailyNote).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { dedupe: true },
    );
  });
});
