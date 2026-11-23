/**
 * coreCrudHandler-valueValidation.test.ts (PBI 2026-11-08-06)
 *
 * The update case checked only the key subset, so mistyped values
 * (scroll_ratio: 5, title: 123) passed the dashboard gate and failed at the
 * SQL CHECK. Values are now checked against the update contract; the key
 * subset error stays byte-identical.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCoreCrudHandler } from '../coreCrudHandler.js';
import type { CoreCrudDeps, DepsResult } from '../deps.js';

function makeDeps(): CoreCrudDeps {
  return {
    toggleStar: vi.fn(async (): Promise<DepsResult<{ is_starred: number }>> => ({ success: true, data: { is_starred: 1 } })),
    delete: vi.fn(async (): Promise<DepsResult<void>> => ({ success: true, data: undefined })),
    update: vi.fn(async (): Promise<DepsResult<void>> => ({ success: true, data: undefined })),
    clearAll: vi.fn(async (): Promise<DepsResult<void>> => ({ success: true, data: undefined })),
    query: vi.fn(),
    getSettings: vi.fn(),
    isConsentGranted: vi.fn(),
    formatEntriesToMarkdown: vi.fn(),
    appendToDailyNote: vi.fn(),
  } as unknown as CoreCrudDeps;
}

describe('coreCrudHandler', () => {
  describe('update value validation', () => {
    it('accepts well-typed changes and delegates', async () => {
      const deps = makeDeps();
      const handler = createCoreCrudHandler(deps);
      const result = await handler({ subtype: 'update', id: 1, changes: { title: 'New' } });
      expect(result).toEqual({ success: true });
      expect(deps.update).toHaveBeenCalledTimes(1);
    });

    it('accepts null as a field clear', async () => {
      const deps = makeDeps();
      const handler = createCoreCrudHandler(deps);
      const result = await handler({ subtype: 'update', id: 1, changes: { title: null } });
      expect(result).toEqual({ success: true });
      expect(deps.update).toHaveBeenCalledTimes(1);
    });

    it('rejects an out-of-range scroll_ratio without calling deps', async () => {
      const deps = makeDeps();
      const handler = createCoreCrudHandler(deps);
      const result = await handler({ subtype: 'update', id: 1, changes: { scroll_ratio: 5 } });
      expect(result).toEqual({ success: false, error: expect.stringContaining('scroll_ratio') });
      expect(deps.update).not.toHaveBeenCalled();
    });

    it('rejects a mistyped title without calling deps', async () => {
      const deps = makeDeps();
      const handler = createCoreCrudHandler(deps);
      const result = await handler({ subtype: 'update', id: 1, changes: { title: 123 } });
      expect(result).toEqual({ success: false, error: expect.stringContaining('title') });
      expect(deps.update).not.toHaveBeenCalled();
    });

    it('rejects a non-flag is_starred without calling deps', async () => {
      const deps = makeDeps();
      const handler = createCoreCrudHandler(deps);
      const result = await handler({ subtype: 'update', id: 1, changes: { is_starred: 2 } });
      expect(result).toEqual({ success: false, error: expect.stringContaining('is_starred') });
      expect(deps.update).not.toHaveBeenCalled();
    });

    it('still rejects unknown keys with the original message', async () => {
      const deps = makeDeps();
      const handler = createCoreCrudHandler(deps);
      const result = await handler({ subtype: 'update', id: 1, changes: { nope: 'x' } });
      expect(result).toEqual({ success: false, error: 'Invalid update fields: nope' });
      expect(deps.update).not.toHaveBeenCalled();
    });
  });
});
