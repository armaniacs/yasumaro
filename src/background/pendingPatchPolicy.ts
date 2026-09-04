/**
 * pendingPatchPolicy.ts — deep module owning the metadata-patch merge policy.
 *
 * Single seam: coalesceMetadataPatch() (URL-merge + truncate + timestamp-max
 * + backoff inheritance + cap). truncatePatchToFit() is the only sizing
 * policy — the queue-level maxPayloadBytes never fires for patches (they
 * carry no `.payload` field), so it is documented here, not duplicated.
 *
 * Runs inside PersistentRetryQueue.mutate() (in-lock), never as a
 * load()/save() pair in the caller.
 *
 * Deletion test: deleting this module leaves the queue enqueueing/flushing
 * degraded without coalescing (adapters separate); deleting the locked queue
 * leaves the policy with nowhere to run.
 */

import { estimatePayloadSize } from './queue/payload.js';
import type { SavedUrlEntryMetadataPatch } from '../utils/storage/savedUrlRepository.js';
import type {
  PendingMetadataPatchWrite,
  QueuedChromeStorageWrite,
} from './pendingChromeStorageQueue.js';

/** Hard cap so a prolonged storage outage can't grow this list unbounded. */
export const MAX_PENDING_WRITES = 500;

/**
 * Per-entry payload cap for a merged metadata patch. content is omitted
 * first when a merge exceeds this; if the payload is still too large
 * afterwards (e.g. very large accumulated tags), tags are truncated too.
 */
export const MAX_PATCH_PAYLOAD_BYTES = 100 * 1024;

/** How many tags to keep (most recent first) when a merge must be truncated. */
export const MAX_TAGS_AFTER_TRUNCATION = 50;

/** Narrow a queued write to a metadata patch. */
export function isMetadataPatchWrite(
  write: QueuedChromeStorageWrite,
): write is PendingMetadataPatchWrite {
  return 'type' in write && write.type === 'metadataPatch';
}

/**
 * Shrink a metadata patch to fit MAX_PATCH_PAYLOAD_BYTES: drop `content`
 * first, then trim `tags` from the front (oldest first) until it fits or
 * nothing is left. Used for both freshly merged and brand-new patches, so
 * the size limit is enforced identically on both paths.
 */
export function truncatePatchToFit(
  patch: SavedUrlEntryMetadataPatch,
): { patch: SavedUrlEntryMetadataPatch; contentOmitted: boolean; tagsOmitted: boolean } {
  let result = patch;
  let contentOmitted = false;
  let tagsOmitted = false;
  let size = estimatePayloadSize(result);

  if (size > MAX_PATCH_PAYLOAD_BYTES && result.content) {
    const { content: _content, ...rest } = result;
    result = rest;
    contentOmitted = true;
    size = estimatePayloadSize(result);
  }

  if (size > MAX_PATCH_PAYLOAD_BYTES && result.tags && result.tags.length > 0) {
    let truncatedTags = result.tags.slice(-MAX_TAGS_AFTER_TRUNCATION);
    let candidate = { ...result, tags: truncatedTags };
    let candidateSize = estimatePayloadSize(candidate);
    // Even MAX_TAGS_AFTER_TRUNCATION tags might still be too large if
    // individual tag strings are unusually long — keep shrinking from the
    // front until it fits or nothing is left.
    while (candidateSize > MAX_PATCH_PAYLOAD_BYTES && truncatedTags.length > 0) {
      truncatedTags = truncatedTags.slice(1);
      candidate = { ...result, tags: truncatedTags };
      candidateSize = estimatePayloadSize(candidate);
    }
    if (truncatedTags.length > 0) {
      result = candidate;
    } else {
      const { tags: _tags, ...rest } = candidate;
      result = rest;
    }
    tagsOmitted = true;
  }

  return { patch: result, contentOmitted, tagsOmitted };
}

function overCapDropOldest(writes: QueuedChromeStorageWrite[]): QueuedChromeStorageWrite[] {
  if (writes.length <= MAX_PENDING_WRITES) return writes;
  return writes.slice(writes.length - MAX_PENDING_WRITES);
}

/**
 * Coalesce an incoming metadata patch into the queued writes (pure).
 * Same-URL entries merge (field spread, tag-union when both sides opt in,
 * latest timestamp wins, backoff inherited via retryCount max); otherwise
 * the truncated patch appends. Queue cap applied by dropping oldest.
 *
 * Flag-shape compat: merged entries always carry contentOmitted/tagsOmitted
 * (even false); fresh entries carry them only when truncation happened —
 * matching the two historical call sites exactly.
 */
export function coalesceMetadataPatch(
  writes: QueuedChromeStorageWrite[],
  incoming: PendingMetadataPatchWrite,
): QueuedChromeStorageWrite[] {
  const sameUrlIndex = writes.findIndex(
    (w) => isMetadataPatchWrite(w) && w.url === incoming.url,
  );
  if (sameUrlIndex < 0) {
    const { patch: fittedPatch, contentOmitted, tagsOmitted } = truncatePatchToFit(incoming.patch);
    const entry: PendingMetadataPatchWrite =
      contentOmitted || tagsOmitted
        ? { ...incoming, patch: fittedPatch, contentOmitted, tagsOmitted }
        : { ...incoming, patch: fittedPatch };
    return overCapDropOldest([...writes, entry]);
  }

  const existing = writes[sameUrlIndex] as PendingMetadataPatchWrite;
  const mergedPatch = { ...existing.patch, ...incoming.patch };
  if (incoming.mergeTags && existing.mergeTags && existing.patch.tags && incoming.patch.tags) {
    mergedPatch.tags = Array.from(new Set([...(existing.patch.tags || []), ...(incoming.patch.tags || [])]));
  }
  const latestTimestamp = Math.max(existing.timestamp || 0, incoming.timestamp || 0);
  const { patch: fittedPatch, contentOmitted, tagsOmitted } = truncatePatchToFit(mergedPatch);
  const next = [...writes];
  next[sameUrlIndex] = {
    ...existing,
    patch: fittedPatch,
    timestamp: latestTimestamp,
    createdAt: existing.createdAt,
    // Backoff inheritance: the merged item still needs delivery, so it keeps
    // the remaining budget instead of resetting to 0 (which gave poison
    // entries infinite life under repeated merges).
    retryCount: Math.max(existing.retryCount || 0, incoming.retryCount || 0),
    contentOmitted,
    tagsOmitted,
  };
  return next;
}
