/**
 * initWasmForNode.test.ts
 * Pins the singleton/retry contract of the Node-side WASM init helpers
 * (`src/wasm/testing/initWasmForNode.ts`): concurrent callers share the
 * in-flight promise, a success is memoized, and a failure resets the
 * singleton so a later call retries, matching the production contract of
 * `initExtensionWasm` in `src/wasm/initWasm.ts`.
 *
 * No real-time waits: the tests gate on promises they resolve themselves and
 * wait for a condition with `waitForMock()` (testDir/waitPolicy.ts).
 */

import { describe, it, expect, vi } from 'vitest';
import { createNodeWasmInit, type NodeWasmGlueInit } from '../initWasmForNode.js';
import { waitForMock } from '../../../../testDir/waitPolicy.js';

describe('initWasmForNode', () => {
  describe('createNodeWasmInit', () => {
    // A real readable file: the helper only reads bytes and feeds them to the
    // glue, so the file's content is irrelevant as long as the read succeeds.
    const wasmUrl = new URL('../../../../package.json', import.meta.url);

    it('reads the file and passes its bytes to the glue init', async () => {
      const glueInit = vi.fn((_init: { module_or_path: Uint8Array }) => Promise.resolve());
      const init = createNodeWasmInit(glueInit as unknown as NodeWasmGlueInit, wasmUrl);

      await init();

      expect(glueInit).toHaveBeenCalledTimes(1);
      const firstArgs = glueInit.mock.calls[0];
      if (!firstArgs) throw new Error('glue init was not called');
      const bytes = firstArgs[0].module_or_path;
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    });

    it('shares one in-flight init across concurrent callers', async () => {
      const { promise: gate, resolve: release } = Promise.withResolvers<void>();
      const glueInit = vi.fn((_init: { module_or_path: Uint8Array }) => gate);
      const init = createNodeWasmInit(glueInit as unknown as NodeWasmGlueInit, wasmUrl);

      const first = init();
      const second = init();
      await waitForMock(() => expect(glueInit).toHaveBeenCalledTimes(1));

      release();
      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
      expect(glueInit).toHaveBeenCalledTimes(1);
    });

    it('reuses the memoized init on later calls after a success', async () => {
      const glueInit = vi.fn((_init: { module_or_path: Uint8Array }) => Promise.resolve());
      const init = createNodeWasmInit(glueInit as unknown as NodeWasmGlueInit, wasmUrl);

      await init();
      await init();

      expect(glueInit).toHaveBeenCalledTimes(1);
    });

    it('retries after a failure instead of caching the rejected promise', async () => {
      const glueInit = vi.fn((_init: { module_or_path: Uint8Array }) => Promise.resolve())
        .mockImplementationOnce(() => Promise.reject(new Error('transient read failure')));
      const init = createNodeWasmInit(glueInit as unknown as NodeWasmGlueInit, wasmUrl);

      await expect(init()).rejects.toThrow('transient read failure');
      await expect(init()).resolves.toBeUndefined();
      expect(glueInit).toHaveBeenCalledTimes(2);
    });
  });
});
