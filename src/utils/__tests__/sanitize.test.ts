import { sanitizeLogDetails } from '../logger/sanitize.js';

describe('sanitizeLogDetails', () => {
  it('masks PII in string values', async () => {
    const out = await sanitizeLogDetails({ email: 'user@example.com' });
    expect(out.email).not.toContain('user@example.com');
  });

  it('handles circular references', async () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const out = await sanitizeLogDetails(obj);
    expect((out.self as Record<string, unknown>).__sanitized).toBeDefined();
  });

  it('returns primitives unchanged', async () => {
    expect(await sanitizeLogDetails({ n: 42, b: true })).toEqual({ n: 42, b: true });
  });
});
