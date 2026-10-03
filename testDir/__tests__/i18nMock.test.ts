import { describe, it, expect, vi } from 'vitest';
import { mockGetMessage } from '../i18nMock.js';

describe('mockGetMessage factory', () => {
  it('forwards (key) to the underlying getMessage when getMessageOr gets no substitutions', () => {
    const getMessage = vi.fn(() => 'Resolved');
    const mock = mockGetMessage(getMessage);

    expect(mock.getMessageOr('someKey', 'Fallback')).toBe('Resolved');
    expect(getMessage).toHaveBeenCalledWith('someKey');
  });

  it('returns the fallback when getMessageOr resolves to a falsy message', () => {
    const getMessage = vi.fn(() => '');
    const mock = mockGetMessage(getMessage);

    expect(mock.getMessageOr('someKey', 'Fallback')).toBe('Fallback');
  });

  it('returns the fallback when the underlying getMessage is a bare vi.fn (undefined)', () => {
    const getMessage = vi.fn();
    const mock = mockGetMessage(getMessage);

    expect(mock.getMessageOr('someKey', 'Fallback')).toBe('Fallback');
    expect(getMessage).toHaveBeenCalledWith('someKey');
  });

  it('forwards (key, subs) to the underlying getMessage when getMessageOr gets substitutions', () => {
    const getMessage = vi.fn(() => 'Resolved');
    const mock = mockGetMessage(getMessage);
    const subs = { count: 2 };

    expect(mock.getMessageOr('someKey', 'Fallback', subs)).toBe('Resolved');
    expect(getMessage).toHaveBeenCalledWith('someKey', subs);
  });

  it('returns the underlying message verbatim from getMessageWithSubstitutions when it is truthy', () => {
    const getMessage = vi.fn(() => 'Hello {name}');
    const mock = mockGetMessage(getMessage);

    expect(mock.getMessageWithSubstitutions('greeting', { name: 'World' }, 'Fallback {name}')).toBe(
      'Hello {name}',
    );
  });

  it('expands {name} tokens in the fallback when getMessageWithSubstitutions resolves to a falsy message', () => {
    const getMessage = vi.fn(() => undefined);
    const mock = mockGetMessage(getMessage);

    expect(
      mock.getMessageWithSubstitutions('missing', { count: 3, total: 9 }, '{count} of {total}'),
    ).toBe('3 of 9');
  });

  it('substitutes repeated tokens and stringifies numeric substitution values', () => {
    const getMessage = vi.fn(() => undefined);
    const mock = mockGetMessage(getMessage);

    expect(
      mock.getMessageWithSubstitutions('missing', { n: 5 }, '{n} + {n} = {total}'),
    ).toBe('5 + 5 = {total}');
  });

  it('keeps unknown token names verbatim in the substituted fallback', () => {
    const getMessage = vi.fn(() => undefined);
    const mock = mockGetMessage(getMessage);

    expect(
      mock.getMessageWithSubstitutions('missing', { present: 'yes' }, '{present} and {absent}'),
    ).toBe('yes and {absent}');
  });
});
