import { describe, it, expect, beforeEach } from 'vitest';
import { enqueueFeedback, getFeedbackQueue, clearFeedbackQueue, removeFeedbackEntry } from '../feedbackQueue.js';
import { StorageKeys } from '../../storage/types.js';

describe('feedbackQueue', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it('enqueue and get round-trip', async () => {
    await enqueueFeedback({ url: 'https://example.com/page', domain: 'example.com', htmlSnippet: '<div>hello</div>', removedByReason: { ads: 2 } });
    const queue = await getFeedbackQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.url).toBe('https://example.com/page');
    expect(queue[0]!.domain).toBe('example.com');
    expect(queue[0]!.htmlSnippet).toBe('<div>hello</div>');
    expect(queue[0]!.removedByReason).toEqual({ ads: 2 });
    expect(typeof queue[0]!.id).toBe('string');
    expect(typeof queue[0]!.createdAt).toBe('number');
  });

  it('truncate htmlSnippet to 500', async () => {
    const long = 'a'.repeat(1000);
    await enqueueFeedback({ url: 'https://example.com', domain: 'example.com', htmlSnippet: long, removedByReason: {} });
    const queue = await getFeedbackQueue();
    expect(queue[0]!.htmlSnippet.length).toBe(500);
  });

  it('persists the AI summary stats alongside the counts', async () => {
    await enqueueFeedback({
      url: 'https://example.com',
      domain: 'example.com',
      htmlSnippet: '<div>hello</div>',
      removedByReason: { keyword: 2 },
      aiSummary: {
        reason: 'multiple',
        reasons: ['ads', 'nav'],
        elements: 12,
        originalBytes: 31204,
        cleansedBytes: 21000,
      },
    });
    const queue = await getFeedbackQueue();
    expect(queue[0]!.aiSummary).toEqual({
      reason: 'multiple',
      reasons: ['ads', 'nav'],
      elements: 12,
      originalBytes: 31204,
      cleansedBytes: 21000,
    });
    // The count map stays count-only: merging the two units is what the
    // persisted field exists to prevent.
    expect(queue[0]!.removedByReason).toEqual({ keyword: 2 });
  });

  it('omits the aiSummary key entirely when the report carried no AI stats', async () => {
    await enqueueFeedback({ url: 'https://example.com', domain: 'example.com', htmlSnippet: 'x', removedByReason: { keyword: 1 } });
    const raw = await chrome.storage.local.get(StorageKeys.CLEANSING_FEEDBACK_QUEUE) as Record<string, unknown>;
    const stored = (raw[StorageKeys.CLEANSING_FEEDBACK_QUEUE] as Record<string, unknown>[])[0]!;
    expect('aiSummary' in stored).toBe(false);
  });

  it('bounds the persisted reason list so one entry cannot dominate the queue', async () => {
    await enqueueFeedback({
      url: 'https://example.com',
      domain: 'example.com',
      htmlSnippet: 'x',
      removedByReason: {},
      aiSummary: {
        reason: 'multiple',
        reasons: Array.from({ length: 200 }, () => 'r'.repeat(500)),
        elements: 1,
        originalBytes: 1,
        cleansedBytes: 1,
      },
    });
    const queue = await getFeedbackQueue();
    expect(queue[0]!.aiSummary!.reasons).toHaveLength(64);
    expect(queue[0]!.aiSummary!.reasons![0]).toHaveLength(128);
  });

  it('reads a legacy entry written before the field existed', async () => {
    const legacy = {
      id: 'legacy-1',
      url: 'https://example.com/old',
      domain: 'example.com',
      htmlSnippet: '<div>old</div>',
      removedByReason: { keyword: 3 },
      createdAt: 1_700_000_000_000,
    };
    await chrome.storage.local.set({ [StorageKeys.CLEANSING_FEEDBACK_QUEUE]: [legacy] });

    const queue = await getFeedbackQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual(legacy);
    expect(queue[0]!.aiSummary).toBeUndefined();
  });

  it('clear removes all', async () => {
    await enqueueFeedback({ url: 'https://example.com', domain: 'example.com', htmlSnippet: 'x', removedByReason: {} });
    await enqueueFeedback({ url: 'https://example.com/2', domain: 'example.com', htmlSnippet: 'y', removedByReason: {} });
    await clearFeedbackQueue();
    const queue = await getFeedbackQueue();
    expect(queue).toHaveLength(0);
  });

  it('removeFeedbackEntry removes by id', async () => {
    await enqueueFeedback({ url: 'https://a.com', domain: 'a.com', htmlSnippet: 'a', removedByReason: {} });
    await enqueueFeedback({ url: 'https://b.com', domain: 'b.com', htmlSnippet: 'b', removedByReason: {} });
    const queue = await getFeedbackQueue();
    const firstId = queue[0]!.id;
    await removeFeedbackEntry(firstId);
    const after = await getFeedbackQueue();
    expect(after).toHaveLength(1);
    expect(after[0]!.url).toBe('https://b.com');
  });

  it('FIFO eviction after 50 entries', async () => {
    for (let i = 0; i < 55; i++) {
      await enqueueFeedback({
        url: `https://example.com/${i}`,
        domain: 'example.com',
        htmlSnippet: `snippet-${i}`,
        removedByReason: {},
        aiSummary: { reason: 'ads', elements: i, originalBytes: i * 10, cleansedBytes: i * 5 },
      });
    }
    const queue = await getFeedbackQueue();
    expect(queue).toHaveLength(50);
    // oldest 5 should be removed, so first element should be 5
    expect(queue[0]!.htmlSnippet).toBe('snippet-5');
    expect(queue[queue.length - 1]!.htmlSnippet).toBe('snippet-54');
    // eviction drops whole entries, so the surviving ones keep their stats
    expect(queue[0]!.aiSummary!.elements).toBe(5);
    expect(queue[queue.length - 1]!.aiSummary!.elements).toBe(54);
  });

  it('storage key is cleansing_feedback_queue', async () => {
    await enqueueFeedback({ url: 'https://example.com', domain: 'example.com', htmlSnippet: 'x', removedByReason: {} });
    const raw = await chrome.storage.local.get(StorageKeys.CLEANSING_FEEDBACK_QUEUE) as Record<string, unknown>;
    expect(Array.isArray(raw[StorageKeys.CLEANSING_FEEDBACK_QUEUE])).toBe(true);
  });

  it('concurrent enqueues both survive the read-modify-write', async () => {
    // Writers go through withOptimisticLock, whose per-key promise chain
    // serializes the read-modify-write. Without it, two interleaved
    // enqueues each read the same base and one entry is silently lost.
    await Promise.all([
      enqueueFeedback({ url: 'https://a.com', domain: 'a.com', htmlSnippet: 'a', removedByReason: {} }),
      enqueueFeedback({ url: 'https://b.com', domain: 'b.com', htmlSnippet: 'b', removedByReason: {} }),
    ]);

    const queue = await getFeedbackQueue();
    expect(queue).toHaveLength(2);
    expect(queue.map(e => e.url).sort()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('concurrent remove and enqueue do not lose either operation', async () => {
    await enqueueFeedback({ url: 'https://a.com', domain: 'a.com', htmlSnippet: 'a', removedByReason: {} });
    const queue = await getFeedbackQueue();
    const firstId = queue[0]!.id;

    await Promise.all([
      removeFeedbackEntry(firstId),
      enqueueFeedback({ url: 'https://b.com', domain: 'b.com', htmlSnippet: 'b', removedByReason: {} }),
    ]);

    const after = await getFeedbackQueue();
    expect(after).toHaveLength(1);
    expect(after[0]!.url).toBe('https://b.com');
  });
});
