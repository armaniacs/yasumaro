import { StorageKeys } from '../storage/types.js';
import type { CleansingFeedbackEntry } from '../storage/types.js';
import type { AiSummaryRemovedStats } from '../commonTypes.js';
import { withOptimisticLock } from '../storage/storageTransaction.js';

const QUEUE_KEY = StorageKeys.CLEANSING_FEEDBACK_QUEUE;
const MAX_QUEUE_SIZE = 50;
const MAX_SNIPPET_LENGTH = 500;
const MAX_AI_REASONS = 64;
const MAX_AI_REASON_CHARS = 128;

function truncateSnippet(snippet: string): string {
  if (snippet.length <= MAX_SNIPPET_LENGTH) return snippet;
  return snippet.slice(0, MAX_SNIPPET_LENGTH);
}

/**
 * Bound the AI-summary stats before they are written.
 *
 * WHY a guard here and not only in the VALID_VISIT validator: this is a public
 * storage writer, so a caller that never crossed the wire could store an
 * unbounded reason list, and 50 such entries would dwarf the 500-char snippets
 * the queue size was chosen around. The byte/element numbers are already
 * finite scalars, so only the array needs bounding.
 */
function clampAiSummary(stats: AiSummaryRemovedStats): AiSummaryRemovedStats {
  if (!stats.reasons) return { ...stats };
  return {
    ...stats,
    reasons: stats.reasons
      .slice(0, MAX_AI_REASONS)
      .map(reason => reason.slice(0, MAX_AI_REASON_CHARS)),
  };
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function readQueue(): Promise<CleansingFeedbackEntry[]> {
  const result = await chrome.storage.local.get(QUEUE_KEY) as Record<string, unknown>;
  const queue = result[QUEUE_KEY] as CleansingFeedbackEntry[] | undefined;
  return Array.isArray(queue) ? queue : [];
}

/**
 * All writers go through withOptimisticLock: this queue is read-modify-write
 * over a shared key, so two concurrent enqueues would otherwise lose one
 * entry (the same VULN-005/056 shape every other persist-and-retry store in
 * the repo guards against). The lock's `<key>_version` companion key is
 * write-only bookkeeping; readers ignore it.
 */
function enqueueEntry(queue: CleansingFeedbackEntry[], entry: Omit<CleansingFeedbackEntry, 'id' | 'createdAt'>): CleansingFeedbackEntry[] {
  const newEntry: CleansingFeedbackEntry = {
    id: generateId(),
    url: entry.url,
    domain: entry.domain,
    htmlSnippet: truncateSnippet(entry.htmlSnippet),
    removedByReason: entry.removedByReason,
    ...(entry.aiSummary ? { aiSummary: clampAiSummary(entry.aiSummary) } : {}),
    createdAt: Date.now(),
  };
  const next = [...queue, newEntry];
  while (next.length > MAX_QUEUE_SIZE) {
    next.shift();
  }
  return next;
}

export async function enqueueFeedback(entry: Omit<CleansingFeedbackEntry, 'id' | 'createdAt'>): Promise<void> {
  await withOptimisticLock<CleansingFeedbackEntry[]>(QUEUE_KEY, (current) => {
    return enqueueEntry(Array.isArray(current) ? current : [], entry);
  });
}

export async function getFeedbackQueue(): Promise<CleansingFeedbackEntry[]> {
  return readQueue();
}

export async function clearFeedbackQueue(): Promise<void> {
  await withOptimisticLock<CleansingFeedbackEntry[]>(QUEUE_KEY, () => []);
}

export async function removeFeedbackEntry(id: string): Promise<void> {
  await withOptimisticLock<CleansingFeedbackEntry[]>(QUEUE_KEY, (current) => {
    const queue = Array.isArray(current) ? current : [];
    return queue.filter(e => e.id !== id);
  });
}
