// @vitest-environment node
/**
 * pendingRowActions.test.ts
 * Shared pending-row action contract (PBI 2026-11-07-17): dispatch from a
 * `data-pending-action` value to the presenter's contract handlers.
 */
import { describe, it, expect, vi } from 'vitest';

import { dispatchPendingRowAction } from '../pendingRowActions.js';
import type { PendingRowActions } from '../pendingRowActions.js';

function makeActions(overrides: Partial<PendingRowActions> = {}): PendingRowActions & {
  onRecord: ReturnType<typeof vi.fn>;
  onRecordWithoutAi: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
} {
  return {
    onRecord: vi.fn().mockResolvedValue({ ok: true }),
    onRecordWithoutAi: vi.fn().mockResolvedValue({ ok: true }),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('pendingRowActions', () => {
  describe('dispatchPendingRowAction', () => {
    it('routes record to onRecord with the exact url', async () => {
      const actions = makeActions();

      const result = await dispatchPendingRowAction('record', 'https://a.example.com', actions);

      expect(actions.onRecord).toHaveBeenCalledTimes(1);
      expect(actions.onRecord).toHaveBeenCalledWith('https://a.example.com');
      expect(actions.onRecordWithoutAi).not.toHaveBeenCalled();
      expect(actions.onDelete).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });

    it('routes recordWithoutAi to onRecordWithoutAi with the exact url', async () => {
      const actions = makeActions();

      const result = await dispatchPendingRowAction('recordWithoutAi', 'https://b.example.com', actions);

      expect(actions.onRecordWithoutAi).toHaveBeenCalledWith('https://b.example.com');
      expect(actions.onRecord).not.toHaveBeenCalled();
      expect(actions.onDelete).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });

    it('routes delete to onDelete and resolves undefined so callers treat it as success', async () => {
      const actions = makeActions();

      const result = await dispatchPendingRowAction('delete', 'https://c.example.com', actions);

      expect(actions.onDelete).toHaveBeenCalledWith('https://c.example.com');
      expect(actions.onRecord).not.toHaveBeenCalled();
      expect(actions.onRecordWithoutAi).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('passes a record failure result through untouched for the caller to throw', async () => {
      const actions = makeActions({ onRecord: vi.fn().mockResolvedValue({ ok: false, error: 'boom' }) });

      const result = await dispatchPendingRowAction('record', 'https://err.example.com', actions);

      expect(result).toEqual({ ok: false, error: 'boom' });
    });

    it('keeps the historical recordWithoutAi fallthrough for unknown action values', async () => {
      const actions = makeActions();

      await dispatchPendingRowAction('bogus', 'https://d.example.com', actions);
      await dispatchPendingRowAction(undefined, 'https://e.example.com', actions);

      expect(actions.onRecordWithoutAi).toHaveBeenCalledTimes(2);
      expect(actions.onDelete).not.toHaveBeenCalled();
    });
  });
});
