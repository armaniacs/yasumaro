/**
 * Shared factory for the handmade `utils/i18n.js` module mock.
 *
 * `getMessageOr` forwards `(key)` or `(key, subs)` to the underlying
 * `getMessage` and returns the fallback only when that result is falsy;
 * `getMessageWithSubstitutions` forwards `(key, subs)` and, on a falsy
 * result, expands `{name}` tokens in the fallback itself. Unknown token
 * names survive verbatim so a partially filled fallback stays inspectable.
 */

type GetMessageFn = (key: string, ...args: any[]) => unknown;

export function mockGetMessage(getMessage: GetMessageFn): {
  getMessage: GetMessageFn;
  getMessageOr: (key: string, fallback: string, subs?: unknown) => string;
  getMessageWithSubstitutions: (
    key: string,
    subs: Record<string, string | number>,
    fallback: string,
  ) => string;
} {
  return {
    getMessage,
    getMessageOr: (key: string, fallback: string, subs?: unknown): string =>
      ((subs === undefined
        ? (getMessage as (...a: any[]) => unknown)(key)
        : (getMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string,
    getMessageWithSubstitutions: (
      key: string,
      subs: Record<string, string | number>,
      fallback: string,
    ): string =>
      ((getMessage as (...a: any[]) => unknown)(key, subs) ||
        fallback.replace(/\{(\w+)\}/g, (_m: string, n: string) =>
          subs[n] !== undefined ? String(subs[n]) : `{${n}}`)) as string,
  };
}
