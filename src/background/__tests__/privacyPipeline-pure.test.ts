/**
 * privacyPipeline-pure.test.ts
 *
 * Mock-free unit tests for the pure functions extracted by PBI 2026-11-20-03
 * (buildPlan / applyMaskResult / formatCloudResult). No chrome/storage access:
 * arguments in, return values out, zero vi.mock calls.
 */

import { describe, expect, it } from 'vitest';
import {
  DEGENERATE_SUMMARY_FALLBACK,
  applyMaskResult,
  buildPlan,
  formatCloudResult,
} from '../privacyPipeline.js';
import type { CloudFormatInput } from '../privacyPipeline.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { Settings } from '../../utils/storage/types.js';

const settingsFor = (mode: unknown, extra: Record<string, unknown> = {}): Settings =>
  ({ [StorageKeys.PRIVACY_MODE]: mode, ...extra }) as unknown as Settings;

const URL = 'https://example.com/page';

function cloudInput(overrides: Partial<CloudFormatInput> = {}): CloudFormatInput {
  return {
    sanitizedSummary: 'Cloud summary',
    aiResult: { summary: 'Cloud summary', success: false },
    maskedCount: 1,
    originalTokens: 10,
    cleansedTokens: 8,
    aiCallDurationMs: 5,
    tagDict: [],
    ...overrides,
  };
}

describe('buildPlan (pure branching decision)', () => {
  it.each([
    ['full_pipeline', false, true, true, true],
    ['masked_cloud', false, false, true, true],
    ['local_only', false, true, true, false],
    ['cloud_only', false, false, false, true],
  ])(
    'mode %s (alreadyProcessed=%s): local=%s mask=%s cloud=%s',
    (mode, alreadyProcessed, wantLocal, wantMask, wantCloud) => {
      const plan = buildPlan(settingsFor(mode), URL, alreadyProcessed as boolean);
      expect(plan.mode).toBe(mode);
      expect(plan.domainPolicy).toBe('allowed');
      expect(plan.useLocalAi).toBe(wantLocal);
      expect(plan.useMasking).toBe(wantMask);
      expect(plan.useCloudAi).toBe(wantCloud);
    },
  );

  it('alreadyProcessed disables masking and local AI but keeps cloud', () => {
    const plan = buildPlan(settingsFor('full_pipeline'), URL, true);
    expect(plan.useLocalAi).toBe(false);
    expect(plan.useMasking).toBe(false);
    expect(plan.useCloudAi).toBe(true);
  });

  it('mask-required forces masking even in cloud_only mode', () => {
    const plan = buildPlan(
      settingsFor('cloud_only', { ai_domain_policy: { 'example.com': 'mask-required' } }),
      URL,
    );
    expect(plan.domainPolicy).toBe('mask-required');
    expect(plan.useMasking).toBe(true);
    expect(plan.useCloudAi).toBe(true);
  });

  it('no-summary resolves without touching AI flags', () => {
    const plan = buildPlan(
      settingsFor('full_pipeline', { ai_domain_policy: { 'example.com': 'no-summary' } }),
      URL,
    );
    expect(plan.domainPolicy).toBe('no-summary');
  });

  it('fails closed on an unknown mode (default masked_cloud: mask on, cloud on)', () => {
    const plan = buildPlan(settingsFor('bogus-mode'), URL);
    expect(plan.mode).toBe('masked_cloud');
    expect(plan.useMasking).toBe(true);
    expect(plan.useCloudAi).toBe(true);
  });

  it('resolves allowed for a URL without a domain row', () => {
    const plan = buildPlan(
      settingsFor('cloud_only', { ai_domain_policy: { 'other.com': 'mask-required' } }),
      URL,
    );
    expect(plan.domainPolicy).toBe('allowed');
    expect(plan.useMasking).toBe(false);
  });
});

describe('applyMaskResult (pure mask combination)', () => {
  it('maps the sanitizer result to text, items, and count', () => {
    const applied = applyMaskResult('raw', {
      text: 'masked',
      maskedItems: ['email', { type: 'phone', original: 'x' }],
    });
    expect(applied.processingText).toBe('masked');
    expect(applied.maskedItems).toEqual(['email', { type: 'phone', original: 'x' }]);
    expect(applied.maskedCount).toBe(2);
  });

  it('passes content through untouched when masking was skipped', () => {
    const applied = applyMaskResult('raw content', null);
    expect(applied).toEqual({ processingText: 'raw content', maskedCount: 0, maskedItems: [] });
  });
});

describe('formatCloudResult (pure cloud formatting)', () => {
  it('passes a normal summary through with counts and duration', () => {
    const out = formatCloudResult(cloudInput());
    expect(out.result.summary).toBe('Cloud summary');
    expect(out.result.aiSucceeded).toBe(false);
    expect(out.result.maskedCount).toBe(1);
    expect(out.result.originalTokens).toBe(10);
    expect(out.result.cleansedTokens).toBe(8);
    expect(out.result.aiCallDurationMs).toBe(5);
    expect(out.degenerate).toBeNull();
  });

  it('counts only real success as aiSucceeded and passes failure metadata through', () => {
    const failure = { kind: 'all-failed' };
    const out = formatCloudResult(
      cloudInput({ sanitizedSummary: 'boom', aiResult: { summary: 'boom', success: false, failure } as never }),
    );
    expect(out.result.aiSucceeded).toBe(false);
    expect(out.result.failure).toEqual(failure);
    expect(out.result.summary).toBe('boom');
  });

  it('marks aiSucceeded on real success', () => {
    const out = formatCloudResult(
      cloudInput({ aiResult: { summary: 'ok', success: true } }),
    );
    expect(out.result.aiSucceeded).toBe(true);
  });

  it('collapses newlines and extra spaces', () => {
    const out = formatCloudResult(
      cloudInput({
        sanitizedSummary: 'one line  with  spaces',
        aiResult: { summary: 'one line  with  spaces', success: false },
      }),
    );
    expect(out.result.summary).toBe('one line with spaces');
    expect(out.result.summary).not.toContain('\n');
  });

  it('extracts tags from the tagged format', () => {
    const tagged = '#tech #news | A calm summary sentence about the event details here';
    const out = formatCloudResult(
        cloudInput({ sanitizedSummary: tagged, aiResult: { summary: tagged, success: false } }),
    );
    expect(out.result.tags).toContain('tech');
    expect(out.result.tags).toContain('news');
    expect(out.result.summary).not.toContain('#tech');
  });

  it('substitutes the degenerate fallback and reports what the executor must log', () => {
    const spam = Array(40).fill('crypto crypto crypto deal').join(' ');
    const out = formatCloudResult(
      cloudInput({
        sanitizedSummary: spam,
        aiResult: { summary: spam, providerName: 'p', success: false },
      }),
    );
    expect(out.result.summary).toBe(DEGENERATE_SUMMARY_FALLBACK);
    expect(out.degenerate).toMatchObject({ reason: 'repetition', providerName: 'p' });
    expect(out.degenerate?.repetitionRate).toBeGreaterThan(0.3);
  });

  it('rides degradedSummary through only when the provider reported degraded', () => {
    const degraded = formatCloudResult(
      cloudInput({
        aiResult: { summary: 's', degraded: true, degradedSummary: 'opening slice', success: false },
      }),
    );
    expect(degraded.result.degradedSummary).toBe('opening slice');

    const normal = formatCloudResult(
      cloudInput({
        aiResult: { summary: 's', degradedSummary: 'opening slice' } as never,
      }),
    );
    expect(normal.result.degradedSummary).toBeUndefined();
  });

  it('handles an empty body without tags or guard verdict', () => {
    const out = formatCloudResult(cloudInput({ sanitizedSummary: '', aiResult: { summary: '', success: false } }));
    expect(out.result.summary).toBe('');
    expect(out.result.tags).toBeUndefined();
    expect(out.degenerate).toBeNull();
    expect(out.result.aiSucceeded).toBe(false);
  });
});
