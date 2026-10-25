// @vitest-environment jsdom
/**
 * contentKernel.lateRescan.test.ts
 * PBI 2026-10-22-06 slice 2 (SPA late-content re-scan): the kernel re-opens
 * the closed gate when the page has grown a full page since the last
 * report, and re-sends through the single extraction seam (so cleansing +
 * PII masking apply to late content exactly as to first content).
 */
import { describe, it, expect, vi } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { PageState } from '../pageState.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';

function makeKernel(opts: {
  reportedChars: number;
  rescanCount: number;
  visibleChars: number | Error;
  scrollPercent?: number;
}): { kernel: ContentKernel; sender: { sendMessageWithRetry: ReturnType<typeof vi.fn> }; pageState: PageState } {
  const pageState = new PageState();
  pageState.minVisitDuration = 0;
  pageState.minScrollDepth = 0;
  pageState.startTime = Date.now() - 120_000;
  pageState.maxScrollPercentage = opts.scrollPercent ?? 100;
  pageState.isValidVisitReported = true;
  pageState.reportedContentChars = opts.reportedChars;
  pageState.lateRescanCount = opts.rescanCount;
  const sender = {
    sendMessageWithRetry: vi.fn(async () => ({ success: true })),
    // ContentKernel also publishes probe state on the same seam in E2E only
    // (not armed here); the spy above records every send for the assertion.
  };
  const kernel = new ContentKernel(
    new InMemoryStoragePort(),
    new InMemoryDomainPolicyPort(),
    () => Date.now(),
    new FakeScheduler(),
    {
      pageState,
      sender,
      readVisibleChars: () => {
        if (opts.visibleChars instanceof Error) throw opts.visibleChars;
        return opts.visibleChars;
      },
    },
  );
  return { kernel, sender, pageState };
}

describe('maybeRearmForLateContent', () => {
  it('re-opens the gate when the page doubled since the report', () => {
    const { kernel, pageState } = makeKernel({ reportedChars: 1000, rescanCount: 0, visibleChars: 5000 });
    expect(kernel.maybeRearmForLateContent()).toBe(true);
    expect(pageState.isValidVisitReported).toBe(false);
    expect(pageState.lateRescanCount).toBe(1);
  });

  it('keeps the gate shut without growth and at the cap', () => {
    expect(makeKernel({ reportedChars: 1000, rescanCount: 0, visibleChars: 1500 }).kernel.maybeRearmForLateContent()).toBe(false);
    expect(makeKernel({ reportedChars: 1000, rescanCount: 2, visibleChars: 9000 }).kernel.maybeRearmForLateContent()).toBe(false);
  });

  it('fails closed when the DOM read throws', () => {
    const { kernel, pageState } = makeKernel({ reportedChars: 1000, rescanCount: 0, visibleChars: new Error('boom') });
    expect(kernel.maybeRearmForLateContent()).toBe(false);
    expect(pageState.isValidVisitReported).toBe(true);
    expect(pageState.lateRescanCount).toBe(0);
  });
});

describe('checkVisitConditions late-content re-report', () => {
  it('re-sends VALID_VISIT through the single extraction seam after growth', async () => {
    document.body.innerHTML = `<article><p>${'late-loaded paragraph. '.repeat(200)}</p></article>`;
    const { kernel, sender, pageState } = makeKernel({ reportedChars: 1000, rescanCount: 0, visibleChars: 6000 });

    kernel.checkVisitConditions();

    // reportValidVisit is fire-and-forget by design; wait for the send
    // condition instead of sleeping (AGENTS.md wait policy).
    await vi.waitFor(() => {
      expect(sender.sendMessageWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'VALID_VISIT' }),
      );
    });
    expect(pageState.lateRescanCount).toBe(1);
    // The re-report commits the visit again, closing the gate it re-opened.
    await vi.waitFor(() => {
      expect(pageState.isValidVisitReported).toBe(true);
    });
  });

  it('does not re-send without growth', () => {
    document.body.innerHTML = '<article><p>short</p></article>';
    const { kernel, sender, pageState } = makeKernel({ reportedChars: 1000, rescanCount: 0, visibleChars: 1200 });

    kernel.checkVisitConditions();

    expect(pageState.lateRescanCount).toBe(0);
    expect(sender.sendMessageWithRetry).not.toHaveBeenCalled();
  });
});
