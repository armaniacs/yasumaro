// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getCleansedReasonText, updateCleansingStatus, renderSpecialUrlStatus } from '../statusPanel.js';

describe('getCleansedReasonText', () => {
    it('returns empty string when cleansedReason is undefined', () => {
        expect(getCleansedReasonText(undefined)).toBe('');
    });

    it('returns empty string when cleansedReason is "none"', () => {
        expect(getCleansedReasonText('none')).toBe('');
    });

    it('returns non-empty string for "hard"', () => {
        const result = getCleansedReasonText('hard');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns non-empty string for "keyword"', () => {
        const result = getCleansedReasonText('keyword');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns non-empty string for "both"', () => {
        const result = getCleansedReasonText('both');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });
});

describe('updateCleansingStatus', () => {
    beforeEach(() => {
        document.body.innerHTML = `<div id="statusCleansingContent"></div>`;
    });

    it('does nothing when element does not exist', () => {
        document.body.innerHTML = '';
        expect(() => updateCleansingStatus({ totalRemoved: 5, hardStripRemoved: 3, keywordStripRemoved: 2 })).not.toThrow();
    });

    it('shows "none" message when cleanseStats is null-like (totalRemoved=0)', () => {
        updateCleansingStatus({ totalRemoved: 0, hardStripRemoved: 0, keywordStripRemoved: 0 });
        const el = document.getElementById('statusCleansingContent');
        expect(el!.innerHTML).toContain('status-muted');
    });

    it('renders html with status-value spans when hardStripRemoved > 0', () => {
        updateCleansingStatus({ totalRemoved: 3, hardStripRemoved: 3, keywordStripRemoved: 0 }, 'hard');
        const el = document.getElementById('statusCleansingContent');
        expect(el!.querySelectorAll('.status-value').length).toBeGreaterThan(0);
    });

    it('renders html with status-value spans when keywordStripRemoved > 0', () => {
        updateCleansingStatus({ totalRemoved: 2, hardStripRemoved: 0, keywordStripRemoved: 2 }, 'keyword');
        const el = document.getElementById('statusCleansingContent');
        expect(el!.querySelectorAll('.status-value').length).toBeGreaterThan(0);
    });

    it('renders spans for both hard and keyword when both applied', () => {
        updateCleansingStatus({ totalRemoved: 5, hardStripRemoved: 3, keywordStripRemoved: 2 }, 'both');
        const el = document.getElementById('statusCleansingContent');
        // hard + keyword + total + reason = 4 spans
        expect(el!.querySelectorAll('.status-value').length).toBeGreaterThanOrEqual(3);
    });
});

describe('renderSpecialUrlStatus', () => {
    beforeEach(() => {
        document.body.innerHTML = `<div id="statusPanel"></div>`;
    });

    it('renders error status in panel', () => {
        renderSpecialUrlStatus();
        const panel = document.getElementById('statusPanel');
        expect(panel!.innerHTML).toContain('status-error');
    });

    it('does nothing when statusPanel element does not exist', () => {
        document.body.innerHTML = '';
        expect(() => renderSpecialUrlStatus()).not.toThrow();
    });
});
