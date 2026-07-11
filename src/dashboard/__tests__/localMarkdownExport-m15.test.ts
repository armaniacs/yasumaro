// @vitest-environment jsdom
/**
 * M15 behavior-parity tests for exportLocalMarkdownCore live in
 * dashboard-handlers.test.ts, alongside the rest of dashboard.ts's mocked
 * dependencies (this file's standalone mock set couldn't satisfy
 * dashboard.ts's full import graph).
 */
import { describe, it, expect } from 'vitest';

describe('localMarkdownExport-m15 (moved)', () => {
    it('see dashboard-handlers.test.ts for the actual M15 tests', () => {
        expect(true).toBe(true);
    });
});
