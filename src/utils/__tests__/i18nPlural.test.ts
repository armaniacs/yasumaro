import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPluralKey } from '../i18nPlural.js';

describe('getPluralKey', () => {
    beforeEach(() => {
        (chrome.i18n.getUILanguage as vi.Mock).mockReturnValue('en');
    });

    it('returns {key}_one for count 1 in English', () => {
        expect(getPluralKey('itemsCount', 1)).toBe('itemsCount_one');
    });

    it('returns {key}_other for count 0 in English', () => {
        expect(getPluralKey('itemsCount', 0)).toBe('itemsCount_other');
    });

    it('returns {key}_other for count greater than 1 in English', () => {
        expect(getPluralKey('itemsCount', 42)).toBe('itemsCount_other');
    });

    it('falls back to base key for Japanese', () => {
        (chrome.i18n.getUILanguage as vi.Mock).mockReturnValue('ja');
        expect(getPluralKey('itemsCount', 1)).toBe('itemsCount');
        expect(getPluralKey('itemsCount', 5)).toBe('itemsCount');
    });

    it('falls back to base key for unknown locales', () => {
        (chrome.i18n.getUILanguage as vi.Mock).mockReturnValue('xx-YY');
        expect(getPluralKey('itemsCount', 1)).toBe('itemsCount');
    });
});
