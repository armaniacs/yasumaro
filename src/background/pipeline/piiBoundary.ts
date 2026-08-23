/**
 * PII Boundary — single seam where MaskedItem (with original) is stripped
 * before external send (sendResponse / storage / log).
 *
 * Internal pipeline types (InProgressRecordingResult) may carry `original`
 * for debugging; all external surfaces must pass through this function.
 */

import type { MaskedItem, StrippedMaskedItem, RecordingResult } from '../../messaging/types.js';
import type { InProgressRecordingResult } from './types.js';

/**
 * Strip PII `original` field from masked items.
 * Idempotent: already-stripped items pass through.
 */
export function stripPiiFromMaskedItem(item: MaskedItem | StrippedMaskedItem): StrippedMaskedItem {
  if (!('original' in item)) return item;
  const { original: _original, ...stripped } = item;
  return stripped;
}

export function stripPiiFromMaskedItems(items: (string | MaskedItem | StrippedMaskedItem)[]): (string | StrippedMaskedItem)[] {
  return items.map((item) => {
    if (typeof item === 'string') return item;
    return stripPiiFromMaskedItem(item);
  });
}

/**
 * Convert an internal pipeline result (may carry `original`) to an external
 * result safe for sendResponse / storage / logging.
 */
export function toExternalResult(internal: InProgressRecordingResult): RecordingResult {
  if (!internal.maskedItems || !Array.isArray(internal.maskedItems)) {
    return internal as RecordingResult;
  }
  return {
    ...internal,
    maskedItems: stripPiiFromMaskedItems(internal.maskedItems),
  } as RecordingResult;
}
