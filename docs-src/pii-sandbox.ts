import { sanitizeRegex, MAX_INPUT_SIZE } from '../src/utils/piiSanitizer.js';
import type { SanitizeResult } from '../src/utils/piiSanitizer.js';

export interface SandboxResult extends SanitizeResult {
  durationMs: number;
}

export async function sanitize(text: string): Promise<SandboxResult> {
  const start = performance.now();
  const result = await sanitizeRegex(text, { includeIndices: true });
  const durationMs = Math.round(performance.now() - start);
  return { ...result, durationMs };
}

export { MAX_INPUT_SIZE };
