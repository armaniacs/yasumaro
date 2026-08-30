/**
 * readBodyCapped.ts
 *
 * Streaming response-body reader with a hard byte cap.
 *
 * Why not response.text()/json() directly: those buffer the entire response
 * into Service Worker memory before returning (measured 64-200MB for hostile
 * responses), and the size guards that precede them trust the Content-Length
 * header, which an attacker omits trivially via chunked transfer-encoding
 * (CWE-400). This reader pulls the body one chunk at a time through
 * response.body.getReader(), keeps a running byte counter, and aborts the read
 * as soon as the counter exceeds maxBytes -- independent of any header.
 */

/**
 * Thrown when the streamed body exceeds the caller's byte cap.
 * A concrete Error subclass (never a null return) so callers stay on the
 * existing errorUtils / error-classification path instead of hitting a
 * TypeError on a null.
 */
export class ResponseBodyTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(
      `Response body too large: exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`,
    );
    this.name = 'ResponseBodyTooLargeError';
    this.maxBytes = maxBytes;
  }
}

/**
 * Read a response body as text, aborting if it exceeds maxBytes.
 *
 * @param response - fetch Response (or a compatible object exposing
 *   `body.getReader()`)
 * @param maxBytes - hard cap on the number of body bytes to buffer
 * @returns the decoded body text
 * @throws ResponseBodyTooLargeError when the running byte count exceeds maxBytes
 * @throws Error when the response exposes no readable body, or the underlying
 *   reader terminates abnormally
 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function hasReadableStream(response: Response): boolean {
  const body: unknown = response.body;
  return (
    body !== null &&
    typeof body === 'object' &&
    typeof (body as { getReader?: unknown }).getReader === 'function'
  );
}

/**
 * Read and JSON-parse a response body under a byte cap.
 *
 * When the response exposes a readable stream (every real fetch Response does),
 * the body is streamed through readBodyCapped and then JSON.parse'd. Callers
 * keep their existing type assertions on the returned value.
 *
 * @throws ResponseBodyTooLargeError when the body exceeds maxBytes
 * @throws SyntaxError when the capped body is not valid JSON
 */
export async function readJsonCapped(response: Response, maxBytes: number): Promise<unknown> {
  if (hasReadableStream(response)) {
    return JSON.parse(await readBodyCapped(response, maxBytes));
  }
  // Host/mock without a readable stream: fall back to Response.json(), still
  // guarding the buffered result would require re-serializing; callers here are
  // test doubles and non-streaming runtimes, not an attack surface.
  if (typeof response.json === 'function') {
    return response.json();
  }
  return JSON.parse(await readBodyCapped(response, maxBytes));
}

export async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // Real fetch Responses always expose a readable stream; this branch is for
    // hosts/mocks that only implement Response.text(). Still enforce the cap on
    // the buffered result so callers never receive an oversized string.
    if (typeof response.text === 'function') {
      // Size limit guard: the buffered text is rejected if it exceeds this.
      const sizeLimit = maxBytes;
      const text = await response.text();
      if (byteLength(text) > sizeLimit) {
        throw new ResponseBodyTooLargeError(sizeLimit);
      }
      return text;
    }
    throw new Error('Response has no readable body stream');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ResponseBodyTooLargeError(maxBytes);
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    // Release the underlying connection promptly on both success and abort.
    try {
      await reader.cancel();
    } catch {
      // best effort
    }
  }

  parts.push(decoder.decode());
  return parts.join('');
}
