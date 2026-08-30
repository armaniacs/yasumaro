import { describe, it, expect } from 'vitest';
import { readBodyCapped, ResponseBodyTooLargeError } from '../readBodyCapped.js';

/**
 * Build a Response-like object whose body streams the given chunks.
 * Content-Length header is intentionally controllable (and may lie).
 */
function makeStreamingResponse(
  chunks: Uint8Array[],
  opts: { contentLength?: string; failAfter?: number } = {},
): Response {
  let index = 0;
  const reader = {
    read(): Promise<{ done: boolean; value?: Uint8Array }> {
      if (opts.failAfter !== undefined && index >= opts.failAfter) {
        return Promise.reject(new Error('network read aborted'));
      }
      if (index >= chunks.length) {
        return Promise.resolve({ done: true, value: undefined });
      }
      const value = chunks[index];
      index += 1;
      return Promise.resolve({ done: false, value });
    },
    cancel(): Promise<void> {
      return Promise.resolve();
    },
  };
  const headers = new Map<string, string>();
  if (opts.contentLength !== undefined) {
    headers.set('content-length', opts.contentLength);
  }
  return {
    body: { getReader: () => reader },
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  } as unknown as Response;
}

const enc = new TextEncoder();

describe('readBodyCapped', () => {
  it('reads a body that is under the cap', async () => {
    const res = makeStreamingResponse([enc.encode('hello world')]);
    await expect(readBodyCapped(res, 100)).resolves.toBe('hello world');
  });

  it('reads an empty body', async () => {
    const res = makeStreamingResponse([]);
    await expect(readBodyCapped(res, 10)).resolves.toBe('');
  });

  it('accepts a body exactly at the cap', async () => {
    const res = makeStreamingResponse([enc.encode('abcde')]);
    await expect(readBodyCapped(res, 5)).resolves.toBe('abcde');
  });

  it('rejects a body one byte over the cap', async () => {
    const res = makeStreamingResponse([enc.encode('abcdef')]);
    await expect(readBodyCapped(res, 5)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
  });

  it('rejects when many 1-byte chunks exceed the cap', async () => {
    const chunks = Array.from({ length: 20 }, (_, i) => enc.encode(String(i % 10)));
    const res = makeStreamingResponse(chunks);
    await expect(readBodyCapped(res, 10)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
  });

  it('ignores a lying Content-Length and caps on actual bytes', async () => {
    const big = enc.encode('x'.repeat(50));
    const res = makeStreamingResponse([big], { contentLength: '10' });
    await expect(readBodyCapped(res, 20)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
  });

  it('does not rely on Content-Length to allow an under-cap body', async () => {
    const res = makeStreamingResponse([enc.encode('short')], { contentLength: '999999999' });
    await expect(readBodyCapped(res, 100)).resolves.toBe('short');
  });

  it('propagates a reader abnormal termination as an Error', async () => {
    const res = makeStreamingResponse([enc.encode('a'), enc.encode('b')], { failAfter: 1 });
    await expect(readBodyCapped(res, 100)).rejects.toThrow(/aborted/);
  });

  it('throws a classifiable Error (not null) when body is missing', async () => {
    const res = { body: null, headers: { get: () => null } } as unknown as Response;
    await expect(readBodyCapped(res, 100)).rejects.toBeInstanceOf(Error);
  });

  it('the too-large error message mentions the limit', async () => {
    const res = makeStreamingResponse([enc.encode('abcdef')]);
    await expect(readBodyCapped(res, 5)).rejects.toThrow(/too large/i);
  });
});
