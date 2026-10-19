/**
 * noRedirectInit.test.ts — the type seam for the redirect policy (PBI 2026-10-19-05).
 *
 * `NO_REDIRECT_FETCH_POLICY` is spread first by every outbound path, so a later
 * `redirect:` key in the same object literal would silently win. The policy is
 * therefore injected through `noRedirectInit(options: Omit<FetchOptions,
 * 'redirect'>)`, and the `@ts-expect-error` below is the guard: the directive
 * fails the build if the override ever becomes legal again, and fails it in the
 * other direction too (an unused directive is an error).
 *
 * The invalid call is wrapped in an uncalled arrow so the runtime never sees it.
 */
import { describe, it, expect } from 'vitest';
import { noRedirectInit, NO_REDIRECT_FETCH_POLICY } from '../../src/utils/fetch.js';

describe('noRedirectInit — redirect policy injection seam', () => {
  it('applies the shared policy alongside ordinary options', () => {
    const init = noRedirectInit({ method: 'GET', headers: { Accept: 'text/plain' } });

    expect(init.redirect).toBe(NO_REDIRECT_FETCH_POLICY.redirect);
    expect(init.method).toBe('GET');
  });

  it('rejects a trailing redirect override at compile time', () => {
    // @ts-expect-error - the seam owns `redirect`; a later override must not compile.
    const overridden = () => noRedirectInit({ redirect: 'follow', method: 'GET' });

    expect(overridden).toBeTypeOf('function');
  });
});
