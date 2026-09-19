import { defineConfig, mergeConfig } from 'vitest/config';
import base from './testDir/vitest.config';

// One-off config for capturing real sanitizeRegex() inputs from the
// existing PII suites — not used by the normal test run. See
// src/wasm/pii-sanitizer/__tests__/setup-capture.ts.
export default mergeConfig(
    base,
    defineConfig({
        test: {
            setupFiles: ['src/wasm/pii-sanitizer/__tests__/setup-capture.ts'],
        },
    })
);
