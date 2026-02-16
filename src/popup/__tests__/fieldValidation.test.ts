/**
 * popup/settings/fieldValidation.ts のテスト
 * フィールドバリデーションのテスト
 */

// Mock chrome API - unique name for this file
const mockChromeForFieldValidation = {
    i18n: {
        getMessage: jest.fn((key: string) => {
            const messages: Record<string, string> = {
                'errorProtocol': 'Protocol must be http or https',
                'errorPort': 'Port must be between 1 and 65535',
                'errorDuration': 'Duration must be 0 or greater',
                'errorScrollDepth': 'Scroll depth must be between 0 and 100',
                'errorInvalidUrl': 'Invalid URL format'
            };
            return messages[key] || key;
        })
    }
};

(global as any).chrome = mockChromeForFieldValidation;

describe('popup/settings/fieldValidation', () => {
    // Helper to create mock input element
    const createMockInput = (value: string = ''): HTMLInputElement => {
        const input = document.createElement('input');
        input.value = value;
        input.setAttribute = jest.fn();
        return input;
    };

    describe('validateProtocol', () => {
        const { validateProtocol } = require('../../popup/settings/fieldValidation');

        it('should return true for http', () => {
            const input = createMockInput('http');
            const result = validateProtocol(input);
            expect(result).toBe(true);
        });

        it('should return true for https', () => {
            const input = createMockInput('https');
            const result = validateProtocol(input);
            expect(result).toBe(true);
        });

        it('should return false for invalid protocol', () => {
            const input = createMockInput('ftp');
            const result = validateProtocol(input);
            expect(result).toBe(false);
        });

        it('should handle case-insensitive input', () => {
            const input = createMockInput('HTTP');
            const result = validateProtocol(input);
            expect(result).toBe(true);
        });

        it('should handle whitespace in input', () => {
            const input = createMockInput('  http  ');
            const result = validateProtocol(input);
            expect(result).toBe(true);
        });
    });

    describe('validatePort', () => {
        const { validatePort } = require('../../popup/settings/fieldValidation');

        it('should return true for valid port', () => {
            const input = createMockInput('27123');
            const result = validatePort(input);
            expect(result).toBe(true);
        });

        it('should return false for port below 1', () => {
            const input = createMockInput('0');
            const result = validatePort(input);
            expect(result).toBe(false);
        });

        it('should return false for port above 65535', () => {
            const input = createMockInput('65536');
            const result = validatePort(input);
            expect(result).toBe(false);
        });

        it('should return false for non-numeric input', () => {
            const input = createMockInput('abc');
            const result = validatePort(input);
            expect(result).toBe(false);
        });
    });

    describe('validateMinVisitDuration', () => {
        const { validateMinVisitDuration } = require('../../popup/settings/fieldValidation');

        it('should return true for valid duration', () => {
            const input = createMockInput('5');
            const result = validateMinVisitDuration(input);
            expect(result).toBe(true);
        });

        it('should return true for 0', () => {
            const input = createMockInput('0');
            const result = validateMinVisitDuration(input);
            expect(result).toBe(true);
        });

        it('should return false for negative number', () => {
            const input = createMockInput('-1');
            const result = validateMinVisitDuration(input);
            expect(result).toBe(false);
        });

        it('should return false for non-numeric input', () => {
            const input = createMockInput('abc');
            const result = validateMinVisitDuration(input);
            expect(result).toBe(false);
        });
    });

    describe('validateMinScrollDepth', () => {
        const { validateMinScrollDepth } = require('../../popup/settings/fieldValidation');

        it('should return true for valid scroll depth', () => {
            const input = createMockInput('50');
            const result = validateMinScrollDepth(input);
            expect(result).toBe(true);
        });

        it('should return true for 0', () => {
            const input = createMockInput('0');
            const result = validateMinScrollDepth(input);
            expect(result).toBe(true);
        });

        it('should return true for 100', () => {
            const input = createMockInput('100');
            const result = validateMinScrollDepth(input);
            expect(result).toBe(true);
        });

        it('should return false for negative number', () => {
            const input = createMockInput('-1');
            const result = validateMinScrollDepth(input);
            expect(result).toBe(false);
        });

        it('should return false for number above 100', () => {
            const input = createMockInput('101');
            const result = validateMinScrollDepth(input);
            expect(result).toBe(false);
        });

        it('should return false for non-numeric input', () => {
            const input = createMockInput('abc');
            const result = validateMinScrollDepth(input);
            expect(result).toBe(false);
        });
    });

    describe('validateAllFields', () => {
        const { validateAllFields } = require('../../popup/settings/fieldValidation');

        it('should return true when all fields are valid', () => {
            const protocolInput = createMockInput('http');
            const portInput = createMockInput('27123');
            const durationInput = createMockInput('5');
            const scrollInput = createMockInput('50');
            
            const result = validateAllFields(protocolInput, portInput, durationInput, scrollInput);
            expect(result).toBe(true);
        });

        it('should return false when any field is invalid', () => {
            const protocolInput = createMockInput('ftp'); // invalid
            const portInput = createMockInput('27123');
            const durationInput = createMockInput('5');
            const scrollInput = createMockInput('50');
            
            const result = validateAllFields(protocolInput, portInput, durationInput, scrollInput);
            expect(result).toBe(false);
        });
    });
});
