import { validateLuhn } from '../luhn.js';

describe('validateLuhn', () => {
    test('validates valid Visa card number', () => {
        expect(validateLuhn('4111-1111-1111-1111')).toBe(true);
        expect(validateLuhn('4111111111111111')).toBe(true);
    });

    test('validates valid MasterCard number', () => {
        expect(validateLuhn('5555555555554444')).toBe(true);
    });

    test('validates valid American Express card number', () => {
        expect(validateLuhn('378282246310005')).toBe(true);
    });

    test('rejects invalid card number (wrong checksum)', () => {
        expect(validateLuhn('4111-1111-1111-1112')).toBe(false);
    });

    test('accepts all zeros (Luhn-valid but not a real card)', () => {
        // Technically passes Luhn check but would be rejected by other validations
        expect(validateLuhn('0000000000000000')).toBe(true);
    });

    test('rejects number that is too short', () => {
        expect(validateLuhn('1234')).toBe(false);
    });

    test('rejects number that is too long', () => {
        expect(validateLuhn('12345678901234567890')).toBe(false);
    });

    test('handles numeric input', () => {
        expect(validateLuhn(4111111111111111)).toBe(true);
    });

    test('handles mixed separators', () => {
        expect(validateLuhn('4111 1111 1111 1111')).toBe(true);
    });
});
