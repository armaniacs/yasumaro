import { describe, it, expect } from 'vitest';
import {
  createRetryContext,
  createStepDeps,
  createSaveSqliteParams,
  createInitialContext,
} from '../contextBuilder.js';
import type { FormattedContext, InitialContext } from '../types.js';
import type { ObsidianClient } from '../../obsidianClient.js';
import type { SqliteClient } from '../../sqlite/offscreenGateway.js';

describe('contextBuilder', () => {
  it('createRetryContext builds privacy Result with tags when provided', () => {
    const ctx = createRetryContext(
      { title: 'T', url: 'https://example.com', summary: 'sum', tags: ['a', 'b'] },
      {} as any,
      'trace-1'
    );
    expect(ctx.data.title).toBe('T');
    expect(ctx.privacyResult?.summary).toBe('sum');
    expect(ctx.privacyResult?.tags).toEqual(['a', 'b']);
    expect(ctx.traceId).toBe('trace-1');
    expect(ctx.force).toBe(true);
  });

  it('createRetryContext omits tags key when undefined (typed builder)', () => {
    const ctx = createRetryContext(
      { title: 'T', url: 'https://example.com', summary: 'sum' },
      {} as any
    );
    expect(ctx.privacyResult?.summary).toBe('sum');
    expect(ctx.privacyResult?.tags).toBeUndefined();
    // traceId not set => undefined, not key with undefined value via builder
    expect((ctx as any).traceId).toBeUndefined();
  });

  it('createStepDeps handles optional urlStore/sqliteClient via explicit conditionals', () => {
    const obsidian = { appendToDailyNote: async () => {} } as unknown as ObsidianClient;
    const depsWithoutOptionals = createStepDeps({ obsidian, aiService: null });
    expect(depsWithoutOptionals.obsidian).toBe(obsidian);
    expect(depsWithoutOptionals.urlStore).toBeUndefined();
    expect(depsWithoutOptionals.sqliteClient).toBeUndefined();

    const fakeStore = { getSavedUrlsWithTimestamps: async () => new Map() };
    const fakeSqlite = { mutate: async () => ({ success: true }) } as unknown as SqliteClient;
    const depsWithOptionals = createStepDeps({
      obsidian,
      aiService: null,
      urlStore: fakeStore as any,
      sqliteClient: fakeSqlite,
    });
    expect(depsWithOptionals.urlStore).toBe(fakeStore);
    expect(depsWithOptionals.sqliteClient).toBe(fakeSqlite);
  });

  it('createSaveSqliteParams omits undefined optional fields', () => {
    const record = { url: 'https://example.com', created_at: 1 } as any;
    const client = { mutate: async () => ({}) } as unknown as SqliteClient;
    const params = createSaveSqliteParams({ recordId: 0, record, sqliteClient: client });
    expect(params.obsidianSynced).toBeUndefined();
    expect(params.traceId).toBeUndefined();
    expect((params as Record<string, unknown>).hasOwnProperty('obsidianSynced')).toBe(false);
  });

  it('createSaveSqliteParams includes defined optionals', () => {
    const record = { url: 'https://example.com', created_at: 1 } as any;
    const client = { mutate: async () => ({}) } as unknown as SqliteClient;
    const params = createSaveSqliteParams({
      recordId: 0,
      record,
      sqliteClient: client,
      obsidianSynced: true,
      traceId: 'trace-xyz',
    });
    expect(params.obsidianSynced).toBe(true);
    expect(params.traceId).toBe('trace-xyz');
  });

  it('createInitialContext builds staged initial context', () => {
    const data = { title: 'T', url: 'https://example.com', content: 'c' } as any;
    const ctx = createInitialContext(data, {} as any, 'trace-abc');
    expect((ctx as any).traceId).toBe('trace-abc');
    expect(ctx.data.url).toBe('https://example.com');
  });

  it('out-of-order read is a type error (compile-time)', () => {
    // This test documents the intended type error. The @ts-expect-error below
    // must not be removed — it proves the builder's branded stage prevents
    // passing an InitialContext where a FormattedContext is required.
    function needsFormatted(ctx: FormattedContext) {
      return ctx.markdown;
    }
    const initial = createInitialContext(
      { title: 'T', url: 'https://example.com', content: '' } as any,
      {} as any,
      'trace-1'
    ) as InitialContext;

    // @ts-expect-error — 'initial' not assignable to 'formatted', out-of-order read is a type error
    needsFormatted(initial);

    // Positive case: properly staged context passes
    const formatted = { ...initial, markdown: 'md' } as unknown as FormattedContext;
    expect(needsFormatted(formatted)).toBe('md');
  });
});
