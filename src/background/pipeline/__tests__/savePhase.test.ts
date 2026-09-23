/**
 * savePhase.test.ts (PBI 2026-09-23-07)
 *
 * Pins the SavePhase seam: one fan-out table owning the 4-sink order, the
 * BEST_EFFORT continuation policy, and the retry-subset projection.
 * End-to-end save semantics (offline enqueue, preview short-circuit, retry
 * entry points) stay pinned by the existing orchestrator tests, which run
 * unmodified alongside this file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger/core.js', () => ({ addLog: vi.fn(), logError: vi.fn() }));
vi.mock('../../../utils/logger/types.js', () => ({
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../utils/logger/api.js', () => ({ addLog: vi.fn(), logError: vi.fn() }));

import { addLog } from '../../../utils/logger/core.js';
import { LogType } from '../../../utils/logger/types.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { ErrorStrategy } from '../types.js';
import type { RecordingContext, StepDeps } from '../types.js';
import { createStepDeps } from '../contextBuilder.js';
import {
  SAVE_SINK_ORDER,
  createSavePhase,
  retryProjection,
  savePhaseSteps,
  type SavePhaseEnv,
} from '../savePhase.js';
import {
  formatMarkdownStep,
  saveLocalMarkdownStep,
  saveMetadataStep,
  saveToObsidianStep,
} from '../steps/index.js';

const mockedAddLog = addLog as unknown as ReturnType<typeof vi.fn>;

function makeObsidian(impl?: () => Promise<void>) {
  return { appendToDailyNote: vi.fn<() => Promise<void>>().mockImplementation(impl ?? (() => Promise.resolve())) };
}

function makeSqlite(mutateImpl?: (args: unknown) => Promise<unknown>) {
  return {
    mutate: vi.fn<(args: unknown) => Promise<unknown>>().mockImplementation(
      mutateImpl ?? (() => Promise.resolve({ success: true, data: { id: 1 } }))
    ),
  };
}

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: { title: 'Save Test', url: 'https://example.com/save', content: 'page body' },
    // Legacy mirror off so saveMetadata returns before touching storage.
    settings: { [StorageKeys.LEGACY_DUAL_WRITE_ENABLED]: false },
    force: false,
    errors: [],
    markdown: '## Save Test\n\npage body',
    ...overrides,
  } as RecordingContext;
}

function makeEnv(): { env: SavePhaseEnv; adapters: { notifier: { notifyError: ReturnType<typeof vi.fn>; notifySaveSuccess: ReturnType<typeof vi.fn> }; pending: { addPending: ReturnType<typeof vi.fn> } } } {
  const adapters = {
    notifier: { notifyError: vi.fn(), notifySaveSuccess: vi.fn() },
    pending: { addPending: vi.fn() },
  };
  // Direct step execution: policy under test is SavePhase's own
  // continuation mapping, not the executor's retry/offline layer.
  const env: SavePhaseEnv = {
    executor: { executeWithStrategy: (step, ctx, deps) => step.execute(ctx, deps) },
    outcomeAdapters: adapters,
  };
  return { env, adapters };
}

function makeDeps(obsidian: unknown, sqliteClient: unknown): StepDeps {
  return createStepDeps({ obsidian: obsidian as never, aiService: {} as never, sqliteClient: sqliteClient as never });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SavePhase fan-out declaration', () => {
  it('owns the canonical order Obsidian -> local -> sqlite -> metadata', () => {
    expect(SAVE_SINK_ORDER).toEqual(['saveObsidian', 'saveLocalMarkdown', 'saveSqlite', 'saveMetadata']);
    expect(savePhaseSteps().map((s) => s.name)).toEqual([...SAVE_SINK_ORDER]);
  });

  it('marks every sink BEST_EFFORT with no preview breakpoint', () => {
    for (const step of savePhaseSteps()) {
      expect(step.errorStrategy).toBe(ErrorStrategy.BEST_EFFORT);
      expect(step.previewBreakpoint).toBeUndefined();
    }
  });

  it('carries offlineRetry only on the Obsidian sink', () => {
    const withRetry = savePhaseSteps().filter((s) => s.offlineRetry);
    expect(withRetry.map((s) => ({ name: s.name, jobKind: s.offlineRetry!.jobKind }))).toEqual([
      { name: 'saveObsidian', jobKind: 'obsidian_sync' },
    ]);
  });

  it('resolves sinks from passed StepDeps, not construction closures', () => {
    const steps = savePhaseSteps();
    expect(steps[0]!.execute).toBe(saveToObsidianStep);
    expect(steps[1]!.execute).toBe(saveLocalMarkdownStep);
    expect(steps[3]!.execute).toBe(saveMetadataStep);
  });
});

describe('SavePhase retryProjection()', () => {
  it('derives exactly formatMarkdown + saveObsidian', () => {
    const projection = retryProjection();
    expect(projection.map((s) => s.name)).toEqual(['formatMarkdown', 'saveObsidian']);
    expect(projection[0]).toMatchObject({ errorStrategy: ErrorStrategy.FATAL, execute: formatMarkdownStep });
    expect(projection[1]).toMatchObject({
      errorStrategy: ErrorStrategy.BEST_EFFORT,
      execute: saveToObsidianStep,
      offlineRetry: { jobKind: 'obsidian_sync' },
    });
  });

  it('returns fresh step objects per call so callers cannot alias the table', () => {
    expect(retryProjection()[1]).not.toBe(savePhaseSteps()[0]);
  });
});

describe('SavePhase save() matrix', () => {
  it('runs all four sinks in order on success', async () => {
    const { env } = makeEnv();
    const phase = createSavePhase(env);
    const obsidian = makeObsidian();
    const sqlite = makeSqlite();
    const context = makeContext();

    const receipt = await phase.save(context, makeDeps(obsidian, sqlite));

    expect(receipt.terminated).toBe(false);
    if (receipt.terminated) return;
    expect(receipt.outcomes).toEqual([
      { name: 'saveObsidian', status: 'ok' },
      { name: 'saveLocalMarkdown', status: 'ok' },
      { name: 'saveSqlite', status: 'ok' },
      { name: 'saveMetadata', status: 'ok' },
    ]);
    // Obsidian write precedes the sqlite insert carrying its synced flag.
    expect(obsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
    expect(sqlite.mutate).toHaveBeenCalledTimes(2);
    expect(sqlite.mutate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'insert', record: expect.objectContaining({ url: 'https://example.com/save' }) })
    );
    expect(sqlite.mutate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'update', changes: { obsidian_synced: 1 } })
    );
    expect(receipt.context.obsidianDuration).toBeDefined();
    expect(receipt.context.errors).toHaveLength(0);
  });

  it('continues past an Obsidian failure and records it as BEST_EFFORT', async () => {
    const { env } = makeEnv();
    const phase = createSavePhase(env);
    const obsidian = makeObsidian(() => Promise.reject(new Error('Obsidian unreachable')));
    const sqlite = makeSqlite();

    const receipt = await phase.save(makeContext(), makeDeps(obsidian, sqlite));

    expect(receipt.terminated).toBe(false);
    if (receipt.terminated) return;
    expect(receipt.outcomes.map((o) => `${o.name}:${o.status}`)).toEqual([
      'saveObsidian:continued',
      'saveLocalMarkdown:ok',
      'saveSqlite:ok',
      'saveMetadata:ok',
    ]);
    // Later sinks still ran despite the earlier failure.
    expect(sqlite.mutate).toHaveBeenCalled();
    expect(receipt.context.errors).toHaveLength(1);
    expect(receipt.context.errors[0]).toMatchObject({
      step: 'saveObsidian',
      strategy: ErrorStrategy.BEST_EFFORT,
      recoveryKind: 'obsidian_sync',
    });
    expect(mockedAddLog).toHaveBeenCalledWith(
      LogType.WARN,
      'Pipeline step saveObsidian failed with best_effort strategy',
      expect.objectContaining({ url: 'https://example.com/save' })
    );
  });

  it('reports sqlite absence as an explicit skip with no error recorded', async () => {
    const { env } = makeEnv();
    const phase = createSavePhase(env);
    const obsidian = makeObsidian();

    const receipt = await phase.save(makeContext(), makeDeps(obsidian, null));

    expect(receipt.terminated).toBe(false);
    if (receipt.terminated) return;
    expect(receipt.outcomes).toContainEqual({
      name: 'saveSqlite',
      status: 'skipped',
      reason: 'sqlite-client-absent',
    });
    expect(receipt.outcomes.map((o) => o.name)).toEqual([...SAVE_SINK_ORDER]);
    expect(receipt.context.errors).toHaveLength(0);
    expect(mockedAddLog).toHaveBeenCalledWith(
      LogType.WARN,
      'No SqliteClient available, skipping SQLite save',
      expect.objectContaining({ url: 'https://example.com/save' })
    );
  });

  it('continues past a sqlite insert failure', async () => {
    const { env } = makeEnv();
    const phase = createSavePhase(env);
    const sqlite = makeSqlite(() => Promise.reject(new Error('disk full')));

    const receipt = await phase.save(makeContext(), makeDeps(makeObsidian(), sqlite));

    expect(receipt.terminated).toBe(false);
    if (receipt.terminated) return;
    expect(receipt.outcomes.map((o) => `${o.name}:${o.status}`)).toEqual([
      'saveObsidian:ok',
      'saveLocalMarkdown:ok',
      'saveSqlite:continued',
      'saveMetadata:ok',
    ]);
    expect(receipt.context.errors).toHaveLength(1);
    expect(receipt.context.errors[0]).toMatchObject({ step: 'saveSqlite', strategy: ErrorStrategy.BEST_EFFORT });
  });

  it('terminates on RegenerateUpdateError without running the metadata sink', async () => {
    const { env, adapters } = makeEnv();
    const phase = createSavePhase(env);
    const sqlite = makeSqlite(() => Promise.resolve({ success: false }));
    const context = makeContext({
      data: { title: 'Regen', url: 'https://example.com/regen', content: 'body', targetEntryId: 42 },
    });

    const receipt = await phase.save(context, makeDeps(makeObsidian(), sqlite));

    expect(receipt.terminated).toBe(true);
    if (!receipt.terminated) return;
    // The terminating sink records no outcome (the terminal result carries
    // it); the metadata sink after it never ran.
    expect(receipt.outcomes.map((o) => o.name)).toEqual(['saveObsidian', 'saveLocalMarkdown']);
    expect(receipt.outcomes.every((o) => o.status === 'ok')).toBe(true);
    expect(receipt.result.success).toBe(false);
    expect(adapters.notifier.notifyError).toHaveBeenCalled();
    expect(adapters.pending.addPending).not.toHaveBeenCalled();
  });

  it('forwards the call-time deps to every sink (no construction closure)', async () => {
    const { env } = makeEnv();
    const seen: StepDeps[] = [];
    const phase = createSavePhase({
      ...env,
      executor: {
        executeWithStrategy: (step, ctx, deps) => {
          seen.push(deps);
          return step.execute(ctx, deps);
        },
      },
    });
    const callObsidian = makeObsidian();
    const receipt = await phase.save(makeContext(), makeDeps(callObsidian, null));

    expect(receipt.terminated).toBe(false);
    // The old closure bug ignored the executed deps; the seam must hand the
    // call-time deps to all four sinks.
    expect(seen).toHaveLength(4);
    for (const deps of seen) {
      expect(deps.obsidian).toBe(callObsidian);
    }
    expect(callObsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
  });
});
