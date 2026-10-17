/**
 * recoveryOwner.test.ts — PBI 2026-10-16-04 (TDD Red).
 *
 * decideRecoveryOwner: enqueued/targetEntryId の組合せを唯一の回復
 * オーナー (offline/pending/none) に写像する純粋関数の真理表。
 */
import { describe, expect, it } from 'vitest';
import { decideRecoveryOwner } from '../types.js';

describe('decideRecoveryOwner — truth table', () => {
  it.each([
    // [targetEntryId, enqueued, expectedOwner]
    [undefined, true, 'offline'],
    [undefined, false, 'pending'],
    [7, true, 'none'],
    [7, false, 'none'],
  ])(
    'targetEntryId=%s enqueued=%s -> %s',
    (targetEntryId, enqueued, expected) => {
      expect(
        decideRecoveryOwner({
          targetEntryId: targetEntryId as number | undefined,
          enqueued: enqueued as boolean,
        }),
      ).toBe(expected);
    },
  );
});
