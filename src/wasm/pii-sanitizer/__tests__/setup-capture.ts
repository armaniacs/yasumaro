/**
 * Vitest setupFile that wraps sanitizeRegex() to record every string input
 * the existing PII test suites pass it, without touching those suites or
 * piiSanitizer.ts. Used only by the one-off capture run described in
 * capture-inputs.README.md — not part of the normal test run (not
 * referenced from vitest.config.ts).
 */

import { vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outPath = fileURLToPath(new URL('./captured-inputs.ndjson', import.meta.url));

vi.mock('../../../utils/piiSanitizer.js', async () => {
    const actual = await vi.importActual<typeof import('../../../utils/piiSanitizer.js')>(
        '../../../utils/piiSanitizer.js'
    );
    return {
        ...actual,
        sanitizeRegex: async (text: unknown, options?: unknown) => {
            if (typeof text === 'string') {
                appendFileSync(outPath, JSON.stringify(text) + '\n');
            }
            return actual.sanitizeRegex(text as string, options as never);
        },
    };
});
