import { describe, it, expect } from 'vitest';
import { isImportError, type ImportLogsResult } from '../importLogsService.js';

describe('importLogsService', () => {
  describe('isImportError', () => {
    it('returns true for an error result, matching the previous inline check', () => {
      const result: ImportLogsResult = { error: 'Invalid JSON format' };
      expect(isImportError(result)).toBe(true);
      expect('error' in result).toBe(isImportError(result));
      if (isImportError(result)) {
        expect(result.error).toBe('Invalid JSON format');
      }
    });

    it('returns false for a success result, matching the previous inline check', () => {
      const result: ImportLogsResult = { inserted: 5, skipped: 2, total: 7 };
      expect(isImportError(result)).toBe(false);
      expect('error' in result).toBe(isImportError(result));
      if (!isImportError(result)) {
        expect(result.inserted).toBe(5);
        expect(result.skipped).toBe(2);
        expect(result.total).toBe(7);
      }
    });
  });
});
