
import { shouldRecordVisit } from '../extractor.js';

describe('Visit Conditions Logic', () => {
    test('fires when both conditions met (5s + 50%)', () => {
        expect(shouldRecordVisit(5, 50)).toBe(true);
        expect(shouldRecordVisit(6, 70)).toBe(true);
        expect(shouldRecordVisit(10, 100)).toBe(true);
    });

    test('does NOT fire when scroll < 50%', () => {
        expect(shouldRecordVisit(10, 30)).toBe(false);
        expect(shouldRecordVisit(10, 49)).toBe(false);
    });

    test('does NOT fire when duration < 5s', () => {
        expect(shouldRecordVisit(4, 70)).toBe(false);
        expect(shouldRecordVisit(0, 100)).toBe(false);
    });

    test('does NOT fire when both conditions unmet', () => {
        expect(shouldRecordVisit(2, 20)).toBe(false);
    });

    test('boundary: exactly at threshold fires', () => {
        expect(shouldRecordVisit(5, 50)).toBe(true);
    });

    test('boundary: just below threshold does NOT fire', () => {
        expect(shouldRecordVisit(4.99, 50)).toBe(false);
        expect(shouldRecordVisit(5, 49.99)).toBe(false);
    });
});
