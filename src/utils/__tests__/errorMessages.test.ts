/**
 * errorMessages.test.ts
 * エラーメッセージユーティリティのテスト
 *
 * 【Code Review P2】: エラーメッセージの技術情報漏洩対策
 */

import {
    type ErrorType,
    classifyError,
    getUserMessage,
    createErrorResponse,
    convertKnownErrorMessage
} from '../errorMessages';

interface ErrorContext {
    url?: string;
    apiKey?: string;
    password?: string;
}

describe('errorMessages', () => {
    describe('classifyError', () => {
        it('should classify network errors correctly', () => {
            expect(classifyError({ message: 'Network error' })).toBe(ErrorType.NETWORK);
            expect(classifyError({ message: 'Connection timeout' })).toBe(ErrorType.NETWORK);
            expect(classifyError({ name: 'TypeError', message: 'fetch failed' })).toBe(ErrorType.NETWORK);
        });

        it('should classify auth errors correctly', () => {
            expect(classifyError({ message: '401 Unauthorized' })).toBe(ErrorType.AUTH);
            expect(classifyError({ message: 'Invalid API key' })).toBe(ErrorType.AUTH);
            expect(classifyError({ message: 'Authentication failed' })).toBe(ErrorType.AUTH);
        });

        it('should classify validation errors correctly', () => {
            expect(classifyError({ message: 'Invalid input' })).toBe(ErrorType.VALIDATION);
            expect(classifyError({ message: 'Validation error' })).toBe(ErrorType.VALIDATION);
        });

        it('should classify not found errors correctly', () => {
            expect(classifyError({ message: '404 Not found' })).toBe(ErrorType.NOT_FOUND);
            expect(classifyError({ message: 'Resource not found' })).toBe(ErrorType.NOT_FOUND);
        });

        it('should classify rate limit errors correctly', () => {
            expect(classifyError({ message: '429 Too many requests' })).toBe(ErrorType.RATE_LIMIT);
            expect(classifyError({ message: 'Rate limit exceeded' })).toBe(ErrorType.RATE_LIMIT);
        });

        it('should classify server errors correctly', () => {
            expect(classifyError({ message: '500 Internal server error' })).toBe(ErrorType.SERVER);
            expect(classifyError({ message: '502 Bad gateway' })).toBe(ErrorType.SERVER);
            expect(classifyError({ message: '503 Service unavailable' })).toBe(ErrorType.SERVER);
        });

        it('should return UNKNOWN for unrecognized errors', () => {
            expect(classifyError({ message: 'Something weird happened' })).toBe(ErrorType.UNKNOWN);
            expect(classifyError(null)).toBe(ErrorType.UNKNOWN);
            expect(classifyError({})).toBe(ErrorType.UNKNOWN);
        });
    });

    describe('getUserMessage', () => {
        it('should return user-friendly message for network errors', () => {
            const message = getUserMessage({ message: 'Network error' });
            expect(message).toContain('ネットワーク');
            expect(message).not.toContain('Network error');
        });

        it('should return user-friendly message for auth errors', () => {
            const message = getUserMessage({ message: 'Invalid API key' });
            expect(message).toContain('認証');
        });

        it('should not expose technical details', () => {
            const message = getUserMessage({ message: 'TypeError: Cannot read property of undefined' });
            expect(message).not.toContain('TypeError');
            expect(message).not.toContain('undefined');
        });
    });

    describe('createErrorResponse', () => {
        it('should create response with user-friendly message', () => {
            const error = new Error('Network connection failed');
            const response = createErrorResponse(error, { url: 'https://example.com' } as ErrorContext);

            expect(response.success).toBe(false);
            expect(response.error).toContain('ネットワーク');
            expect(response.error).not.toContain('Network connection failed');
            expect(response.errorType).toBe(ErrorType.NETWORK);
        });

        it('should redact sensitive information from context', () => {
            const error = new Error('Auth failed');
            const response = createErrorResponse(error, {
                apiKey: 'secret-key-123',
                password: 'my-password',
                url: 'https://example.com'
            } as ErrorContext);

            expect(response.success).toBe(false);
            // The response should not contain sensitive data
            expect(response.error).not.toContain('secret-key-123');
            expect(response.error).not.toContain('my-password');
        });
    });

    describe('convertKnownErrorMessage', () => {
        it('should convert domain blocked error', () => {
            const message = convertKnownErrorMessage('Domain blocked by filter');
            expect(message).toContain('ブロック');
        });

        it('should convert Obsidian connection error', () => {
            const message = convertKnownErrorMessage('Obsidian connection failed');
            expect(message).toContain('Obsidian');
        });

        it('should convert AI summarization error', () => {
            const message = convertKnownErrorMessage('AI summarization failed');
            expect(message).toContain('AI要約');
        });

        it('should handle empty input', () => {
            const message = convertKnownErrorMessage('');
            expect(message).toBeTruthy();
        });

        it('should handle null input', () => {
            const message = convertKnownErrorMessage(null);
            expect(message).toBeTruthy();
        });
    });
});