/**
 * applyAutoTagRulesStep.test.ts
 * PBI 2026-10-23-06: the pipeline step merges enabled rule tags after the AI
 * tags, logs provenance for the undo, and never breaks the record.
 */
import { describe, it, expect, vi } from 'vitest';
import { createApplyAutoTagRulesStep } from '../applyAutoTagRulesStep.js';
import { StorageKeys, type Settings } from '../../../../utils/storage/types.js';
import type { AutoTagApplication } from '../../../../utils/storage/autoTagRules.js';
import type { RecordingContext } from '../../types.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Docs page',
      url: 'https://docs.example.com/guide',
      content: 'Some content',
    },
    settings: {
      [StorageKeys.AUTO_TAG_RULES]: {},
      [StorageKeys.TAG_NORMALIZATION_DICT]: [],
    },
    force: false,
    errors: [],
    privacyResult: { summary: 's', aiSucceeded: true, tags: ['ai-tag'] },
    ...overrides,
  } as RecordingContext;
}

const DOCS_RULE = {
  r_docs: {
    id: 'r_docs',
    name: 'Docs',
    domainSuffix: 'example.com',
    tag: 'docs',
    priority: 10,
    enabled: true,
  },
};

describe('applyAutoTagRulesStep', () => {
  it('merges rule tags after AI tags and logs provenance', async () => {
    const appendApplications = vi.fn(async (_entries: AutoTagApplication[]) => {});
    const step = createApplyAutoTagRulesStep({ appendApplications });
    const out = await step(makeContext({
      settings: {
        [StorageKeys.AUTO_TAG_RULES]: DOCS_RULE,
        [StorageKeys.TAG_NORMALIZATION_DICT]: [],
      } as unknown as Settings,
    }));
    expect(out.privacyResult?.tags).toEqual(['ai-tag', 'docs']);
    expect(appendApplications).toHaveBeenCalledTimes(1);
    const firstCall = appendApplications.mock.calls[0];
    if (!firstCall) throw new Error('expected one provenance write');
    const entries = firstCall[0];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ruleId: 'r_docs', tag: 'docs', url: 'https://docs.example.com/guide' });
  });

  it('skips preview runs and empty matches without touching the sink', async () => {
    const appendApplications = vi.fn(async () => {});
    const step = createApplyAutoTagRulesStep({ appendApplications });
    const preview = await step(makeContext({ data: { title: 'T', url: 'https://docs.example.com/', content: 'c', previewOnly: true } }));
    expect(preview.privacyResult?.tags).toEqual(['ai-tag']);
    const noRules = await step(makeContext());
    expect(noRules.privacyResult?.tags).toEqual(['ai-tag']);
    expect(appendApplications).not.toHaveBeenCalled();
  });

  it('folds rule tags through the normalization dictionary', async () => {
    const appendApplications = vi.fn(async () => {});
    const step = createApplyAutoTagRulesStep({ appendApplications });
    const out = await step(makeContext({
      settings: {
        [StorageKeys.AUTO_TAG_RULES]: DOCS_RULE,
        [StorageKeys.TAG_NORMALIZATION_DICT]: [{ from: 'docs', to: 'documentation' }],
      } as unknown as Settings,
    }));
    expect(out.privacyResult?.tags).toEqual(['ai-tag', 'documentation']);
  });

  it('keeps the record when the provenance sink throws', async () => {
    const step = createApplyAutoTagRulesStep({
      appendApplications: async () => { throw new Error('store down'); },
    });
    const out = await step(makeContext({
      settings: {
        [StorageKeys.AUTO_TAG_RULES]: DOCS_RULE,
        [StorageKeys.TAG_NORMALIZATION_DICT]: [],
      } as unknown as Settings,
    }));
    expect(out.privacyResult?.tags).toEqual(['ai-tag', 'docs']);
  });

  it('returns the context untouched without a privacy result', async () => {
    const appendApplications = vi.fn(async () => {});
    const step = createApplyAutoTagRulesStep({ appendApplications });
    const ctx = makeContext();
    delete ctx.privacyResult;
    const out = await step(ctx);
    expect(out).toBe(ctx);
    expect(appendApplications).not.toHaveBeenCalled();
  });
});
