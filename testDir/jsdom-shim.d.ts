/**
 * Minimal ambient declaration for `jsdom`, used only by test files.
 * The package ships no types and `@types/jsdom` is not a dependency; tests
 * need just the `JSDOM` constructor and its `window`/`document` surface.
 */
declare module 'jsdom' {
  export interface DOMWindow extends Window {
    [key: string]: unknown;
  }

  export interface ConstructorOptions {
    url?: string;
    referrer?: string;
    contentType?: string;
    runScripts?: 'dangerously' | 'outside-only';
    resources?: 'usable' | unknown;
    pretendToBeVisual?: boolean;
    storageQuota?: number;
    beforeParse?: (window: DOMWindow) => void;
  }

  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: DOMWindow;
    serialize(): string;
    static fragment(html: string): DocumentFragment;
  }

  export const VirtualConsole: unknown;
  export const CookieJar: unknown;
  export const ResourceLoader: unknown;
}
