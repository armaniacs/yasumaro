import { maskSensitiveData } from '../sensitiveDataMask.js';

describe('maskSensitiveData recursion guard', () => {
  it('cuts off circular objects with the same mask as too-deep', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    const result = maskSensitiveData(obj, 'full') as Record<string, unknown>;
    expect(result.name).toBe('test');
    expect(result.self).toBe('[REDACTED: too deep]');

    const partial = maskSensitiveData(obj, 'partial') as Record<string, unknown>;
    expect(partial.self).toBe('***');
  });

  it('keeps __proto__ as own property without rewriting prototype', () => {
    const input = JSON.parse('{"__proto__":{"polluted":"yes"},"name":"test"}');
    const result = maskSensitiveData(input, 'full') as Record<string, unknown>;
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect((result.name as string)).toBe('test');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
