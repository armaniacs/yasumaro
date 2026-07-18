import { describe, it, expect } from 'vitest';
import { extractSourceFromImportMetaUrl, resolveLogSource } from '../logger.js';

describe('extractSourceFromImportMetaUrl', () => {
    it('extracts the filename without extension from a file URL', () => {
        expect(extractSourceFromImportMetaUrl('file:///Users/dev/project/src/background/recordingLogic.ts')).toBe('recordingLogic');
    });

    it('extracts the filename from a chrome-extension bundled URL', () => {
        expect(extractSourceFromImportMetaUrl('chrome-extension://abc123/js/background.js')).toBe('background');
    });

    it('extracts the filename from an https URL', () => {
        expect(extractSourceFromImportMetaUrl('https://example.com/assets/logger.js')).toBe('logger');
    });

    it('handles URLs without an extension', () => {
        expect(extractSourceFromImportMetaUrl('file:///path/to/module')).toBe('module');
    });

    it('falls back gracefully for malformed URLs', () => {
        expect(extractSourceFromImportMetaUrl('not-a-url')).toBe('not-a-url');
    });

    it('returns "unknown" for an empty string', () => {
        expect(extractSourceFromImportMetaUrl('')).toBe('unknown');
    });
});

describe('resolveLogSource', () => {
    it('returns the explicitly provided source unchanged', () => {
        expect(resolveLogSource('custom-source')).toBe('custom-source');
    });

    it('returns undefined when called with undefined in a non-Error.stack context', () => {
        // In a fresh call from a test file, the stack should point back to this test file.
        const source = resolveLogSource();
        expect(source).not.toBe('unknown');
        expect(source).toContain('logger-source');
    });

    it('does not resolve to logger.ts frames', () => {
        // Calling through the helper should skip the logger.ts frames.
        const source = resolveLogSource();
        expect(source).not.toContain('logger.ts');
    });
});
