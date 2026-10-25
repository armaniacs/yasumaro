/**
 * researchReportHandlers.test.ts
 * PBI 2026-10-23-09 — 調査レポート一発生成 (EXPORT_RESEARCH_REPORT handler).
 * Pins: scope shaping through the canonical normalizer (blank strings and
 * non-finite numbers degrade to absent, unknown fields are dropped),
 * sendToObsidian coercion (only true opts in), generator outcome passthrough
 * (縮退・失敗は偽成功にならない), and the defensive throw catch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResearchReportHandler } from '../researchReportHandlers.js';

const EXTENSION_SENDER = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/options.html',
} as unknown as chrome.runtime.MessageSender;

function makeGenerator(outcome: unknown) {
  return { generate: vi.fn().mockResolvedValue(outcome) };
}

async function runHandler(
  generator: { generate: ReturnType<typeof vi.fn> },
  payload: Record<string, unknown> | undefined,
): Promise<{ response: Record<string, unknown>; generator: { generate: ReturnType<typeof vi.fn> } }> {
  const handler = createResearchReportHandler({ researchReportGenerator: generator as never });
  const sendResponse = vi.fn();
  await handler(
    { type: 'EXPORT_RESEARCH_REPORT', ...(payload === undefined ? {} : { payload }) },
    EXTENSION_SENDER,
    sendResponse,
  );
  return {
    response: sendResponse.mock.calls[0]?.[0] as Record<string, unknown>,
    generator,
  };
}

describe('createResearchReportHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes a valid scope through and returns the generator outcome', async () => {
    const generator = makeGenerator({ success: true, recordCount: 2, deliveredTo: ['download'] });
    const { response } = await runHandler(generator, {
      scope: { search: 'rust', tag: 'tools', since: 1000, until: 2000 },
      sendToObsidian: false,
    });
    expect(generator.generate).toHaveBeenCalledWith({
      scope: { search: 'rust', tag: 'tools', since: 1000, until: 2000 },
      sendToObsidian: false,
    });
    expect(response).toEqual({ success: true, recordCount: 2, deliveredTo: ['download'] });
  });

  it('degrades blank strings, non-finite numbers and unknown fields to absent', async () => {
    const generator = makeGenerator({ success: true, recordCount: 1, deliveredTo: ['download'] });
    await runHandler(generator, {
      scope: { search: '   ', tag: '', since: Number.NaN, until: Number.POSITIVE_INFINITY, extra: 'dropped' },
    });
    expect(generator.generate).toHaveBeenCalledWith({ scope: {}, sendToObsidian: false });
  });

  it('trims a padded search term and coerces sendToObsidian (only true opts in)', async () => {
    const generator = makeGenerator({ success: true, recordCount: 1, deliveredTo: ['download', 'obsidian'] });
    await runHandler(generator, { scope: { search: '  wasm  ' }, sendToObsidian: true });
    expect(generator.generate).toHaveBeenCalledWith({
      scope: { search: 'wasm' },
      sendToObsidian: true,
    });
  });

  it('degrades a missing payload to the empty (whole-history, capped) scope', async () => {
    const generator = makeGenerator({ success: true, recordCount: 5, deliveredTo: ['download'] });
    const { response } = await runHandler(generator, undefined);
    expect(generator.generate).toHaveBeenCalledWith({ scope: {}, sendToObsidian: false });
    expect(response.success).toBe(true);
  });

  it('passes a generator failure through with its reason (never a fake success)', async () => {
    const generator = makeGenerator({ success: false, error: 'no_records' });
    const { response } = await runHandler(generator, { scope: { search: 'nothing-matches-this' } });
    expect(response).toEqual({ success: false, error: 'no_records' });
  });

  it('maps a throwing generator to report_failed instead of hanging', async () => {
    const generator = { generate: vi.fn().mockRejectedValue(new Error('db gone')) };
    const { response } = await runHandler(generator, { scope: {} });
    expect(response).toEqual({ success: false, error: 'db gone' });
  });

  it('maps a non-Error throw to the report_failed default', async () => {
    const generator = { generate: vi.fn().mockRejectedValue('string boom') };
    const { response } = await runHandler(generator, { scope: {} });
    expect(response).toEqual({ success: false, error: 'report_failed' });
  });
});
