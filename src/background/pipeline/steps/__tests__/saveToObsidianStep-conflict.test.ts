import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../utils/logger/types.js');
vi.mock('../../../../utils/logger/core.js');
vi.mock('../../../../utils/logger/api.js');

import { saveToObsidianStep } from '../saveToObsidianStep.js';
import type { RecordingContext, StepDeps } from '../../types.js';
import { FailureKind, createFailure, tagFailure, resolveFailure } from '../../../../utils/failureTaxonomy.js';
import { addLog } from '../../../../utils/logger/core.js';

function conflictError(): Error {
  return tagFailure(new Error('write failed'), createFailure(FailureKind.HTTP, { status: 412, method: 'PUT' }));
}

function serverError(): Error {
  return tagFailure(new Error('write failed'), createFailure(FailureKind.HTTP, { status: 503, method: 'PUT' }));
}

function makeContext(): RecordingContext {
  return {
    data: { title: 'T', url: 'https://example.com', content: 'c' },
    settings: {},
    force: false,
    errors: [],
    markdown: '## T',
    traceId: 'trace-1',
  } as unknown as RecordingContext;
}

function makeDeps(append: ReturnType<typeof vi.fn>): StepDeps {
  return { obsidian: { appendToDailyNote: append }, aiService: {} } as unknown as StepDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveToObsidianStep', () => {
  describe('precondition conflict rewrite', () => {
    it('rewrites once after a 412 and completes the save', async () => {
      const append = vi.fn().mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(undefined);

      const result = await saveToObsidianStep(makeContext(), makeDeps(append));

      expect(append).toHaveBeenCalledTimes(2);
      expect(result.obsidianDuration).toBeTypeOf('number');
      expect(addLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('conflict'),
        expect.objectContaining({ traceId: 'trace-1' }),
      );
    });

    it('stops after a single rewrite and rethrows the conflict', async () => {
      const append = vi.fn().mockRejectedValue(conflictError());

      const thrown = await saveToObsidianStep(makeContext(), makeDeps(append)).catch((e: unknown) => e);

      expect(append).toHaveBeenCalledTimes(2);
      expect(resolveFailure(thrown)).toMatchObject({ status: 412, method: 'PUT' });
    });

    it.each([
      ['non-412 http failure', serverError()],
      ['untagged error', new Error('boom')],
    ])('does not rewrite on %s', async (_label, error) => {
      const append = vi.fn().mockRejectedValue(error);

      await expect(saveToObsidianStep(makeContext(), makeDeps(append))).rejects.toThrow();

      expect(append).toHaveBeenCalledTimes(1);
    });

    it('keeps replay dedupe on the rewrite', async () => {
      const append = vi.fn().mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(undefined);
      const context = { ...makeContext(), replayWrite: true } as RecordingContext;

      await saveToObsidianStep(context, makeDeps(append));

      expect(append).toHaveBeenNthCalledWith(2, '## T', 'trace-1', { dedupe: true });
    });
  });
});
