/**
 * string.test.ts
 * Unit tests for src/utils/string.ts (escapeRegExp, moved from cspSettings.ts
 * during PBI-23's static-facade deepening).
 */
import { escapeRegExp } from '../string.js';

describe('escapeRegExp', () => {
  test('escapes regex special characters', () => {
    expect(escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe('a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o');
  });

  test('returns string unchanged when no special characters', () => {
    expect(escapeRegExp('hello-world_123')).toBe('hello-world_123');
  });

  test('handles empty string', () => {
    expect(escapeRegExp('')).toBe('');
  });
});
