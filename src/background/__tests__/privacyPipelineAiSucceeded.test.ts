/**
 * privacyPipelineAiSucceeded.test.ts — PBI 2026-09-22-04 follow-up.
 *
 * The `aiSucceeded` flag tells regenerate whether a real AI model produced
 * the summary (failed providers return their error text inside `summary`,
 * which legacy save paths keep writing verbatim).
 */
import { describe, it, expect, vi } from 'vitest';
import { PrivacyPipeline } from '../privacyPipeline.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { AIService } from '../ai/AIService.js';

function makeAiService(handlers: {
  local?: (content: string) => unknown;
  cloud?: (content: string) => unknown;
}): AIService {
  return {
    generateSummary: vi.fn(async (content: string, options?: { mode?: string }) =>
      options?.mode === 'local_only'
        ? ((handlers.local ?? (() => ({ success: false }))) as (c: string) => unknown)(content)
        : ((handlers.cloud ?? (() => ({ success: false }))) as (c: string) => unknown)(content),
    ),
    getSupportedModes: () => ['local_only', 'full_pipeline', 'masked_cloud'],
  } as unknown as AIService;
}

const baseSettings = {
  [StorageKeys.PRIVACY_MODE]: 'full_pipeline',
} as never;

const sanitizers = {
  sanitizeRegex: async (text: string) => ({ text, maskedItems: [] as never[] }),
};

describe('PrivacyPipeline aiSucceeded (PBI 2026-09-22-04 follow-up)', () => {
  it('cloud success → aiSucceeded true, summary preserved', async () => {
    const ai = makeAiService({
      cloud: () => ({ success: true, summary: 'A proper summary of the page.' }),
    });
    const pipe = new PrivacyPipeline(baseSettings, ai, sanitizers);
    const out = await pipe.process('Some page content here for the summary.', { url: 'https://x.test' });
    expect(out.aiSucceeded).toBe(true);
    expect(out.summary).toContain('A proper summary');
  });

  it('cloud all-fail → aiSucceeded false, error summary preserved for the legacy save path', async () => {
    const ai = makeAiService({
      cloud: () => ({ success: false, summary: 'Prompt failed: An unknown error occurred: kErrorUnknown' }),
    });
    const pipe = new PrivacyPipeline(baseSettings, ai, sanitizers);
    const out = await pipe.process('Some page content here for the summary.', { url: 'https://x.test' });
    expect(out.aiSucceeded).toBe(false);
    // Legacy behavior unchanged: the text still flows to storage.
    expect(out.summary).toContain('Prompt failed');
  });

  it('empty content → aiSucceeded false', async () => {
    const ai = makeAiService({});
    const pipe = new PrivacyPipeline(baseSettings, ai, sanitizers);
    const out = await pipe.process('', { url: 'https://x.test' });
    expect(out.aiSucceeded).toBe(false);
    expect(out.summary).toBe('Summary not available.');
  });

  it('local_only success → aiSucceeded true', async () => {
    const ai = makeAiService({
      local: () => ({ success: true, summary: 'Locally produced summary text.' }),
    });
    const pipe = new PrivacyPipeline(
      { [StorageKeys.PRIVACY_MODE]: 'local_only' } as never,
      ai,
      sanitizers,
    );
    const out = await pipe.process('Some page content here for the summary.', { url: 'https://x.test' });
    expect(out.aiSucceeded).toBe(true);
    expect(out.summary).toContain('Locally produced');
  });
});
