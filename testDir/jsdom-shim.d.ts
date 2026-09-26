/**
 * Ambient stub for `jsdom`, used only by test files. The package ships no types
 * and `@types/jsdom` is not a dependency. This intentionally keeps the surface
 * loose (matching the previous implicit-any behaviour) so it does not surface
 * unrelated type errors in test files that already relied on the untyped import.
 */
declare module 'jsdom' {
  export type JSDOM = any;
  export const JSDOM: any;
  export const VirtualConsole: any;
  export const CookieJar: any;
  export const ResourceLoader: any;
}
