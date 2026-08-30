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
      await enqueueFeedback({ url: `https://example.com/${i}`, domain: 'example.com', htmlSnippet: `snippet-${i}`, removedByReason: {} });
    }
    const queue = await getFeedbackQueue();
    expect(queue).toHaveLength(50);
    // oldest 5 should be removed, so first element should be 5
    expect(queue[0]!.htmlSnippet).toBe('snippet-5');
    expect(queue[queue.length - 1]!.htmlSnippet).toBe('snippet-54');
  });

  it('storage key is cleansing_feedback_queue', async () => {
    await enqueueFeedback({ url: 'https://example.com', domain: 'example.com', htmlSnippet: 'x', removedByReason: {} });
    const raw = await chrome.storage.local.get(StorageKeys.CLEANSING_FEEDBACK_QUEUE) as Record<string, unknown>;
    expect(Array.isArray(raw[StorageKeys.CLEANSING_FEEDBACK_QUEUE])).toBe(true);
  });
});
