import { describe, it, expect } from 'vitest';
import { extractSourceFromImportMetaUrl } from '../logger.js';

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

