import { describe, it, expect, vi } from 'vitest';
import {
  ErrorType,
  classifyError,
  getErrorI18nKey,
  getUserMessage,
  convertKnownErrorMessage,
  createErrorResponse,
} from '../errorClassification.js';

describe('classifyError', () => {
  it('returns UNKNOWN for null/undefined/empty errors', () => {
    expect(classifyError(null)).toBe(ErrorType.UNKNOWN);
    expect(classifyError(undefined)).toBe(ErrorType.UNKNOWN);
    expect(classifyError('')).toBe(ErrorType.UNKNOWN);
  });

  it('classifies source-based popup errors', () => {
    expect(classifyError({ source: 'obsidian' })).toBe(ErrorType.SERVER);
    expect(classifyError({ source: 'ai' })).toBe(ErrorType.SERVER);
    expect(classifyError({ source: 'network' })).toBe(ErrorType.NETWORK);
    expect(classifyError({ source: 'user' })).toBe(ErrorType.VALIDATION);
    expect(classifyError({ source: 'system' })).toBe(ErrorType.SERVER);
    expect(classifyError({ source: 'unknown' })).toBe(ErrorType.UNKNOWN);
  });

  it('classifies network errors', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe(ErrorType.NETWORK);
    expect(classifyError(new Error('network error'))).toBe(ErrorType.NETWORK);
    expect(classifyError(new Error('connection refused'))).toBe(ErrorType.NETWORK);
    expect(classifyError(new Error('request timeout'))).toBe(ErrorType.NETWORK);
  });

  it('classifies auth errors', () => {
    expect(classifyError(new Error('401 unauthorized'))).toBe(ErrorType.AUTH);
    expect(classifyError(new Error('invalid api key'))).toBe(ErrorType.AUTH);
    expect(classifyError(new Error('authentication failed'))).toBe(ErrorType.AUTH);
  });

  it('classifies validation errors', () => {
    expect(classifyError(new Error('invalid input'))).toBe(ErrorType.VALIDATION);
    expect(classifyError(new Error('validation failed'))).toBe(ErrorType.VALIDATION);
    expect(classifyError(new Error('not allowed'))).toBe(ErrorType.VALIDATION);
  });

  it('classifies domain blocked errors', () => {
    expect(classifyError(new Error('domain is blocked'))).toBe(ErrorType.DOMAIN_BLOCKED);
  });

  it('classifies not found errors', () => {
    expect(classifyError(new Error('404 not found'))).toBe(ErrorType.NOT_FOUND);
  });

  it('classifies rate limit errors', () => {
    expect(classifyError(new Error('429 rate limit'))).toBe(ErrorType.RATE_LIMIT);
    expect(classifyError(new Error('too many requests'))).toBe(ErrorType.RATE_LIMIT);
  });

  it('classifies server errors', () => {
    expect(classifyError(new Error('500 internal server error'))).toBe(ErrorType.SERVER);
    expect(classifyError(new Error('502 bad gateway'))).toBe(ErrorType.SERVER);
    expect(classifyError(new Error('503 service unavailable'))).toBe(ErrorType.SERVER);
    expect(classifyError(new Error('server error'))).toBe(ErrorType.SERVER);
  });

  it('classifies unknown errors', () => {
    expect(classifyError(new Error('something else'))).toBe(ErrorType.UNKNOWN);
  });

  it('handles error-like objects without instanceof Error', () => {
    expect(classifyError({ message: 'network error' })).toBe(ErrorType.NETWORK);
    expect(classifyError({ name: 'TypeError', message: 'Failed to fetch' })).toBe(ErrorType.NETWORK);
    expect(classifyError({ name: 'CustomError' })).toBe(ErrorType.UNKNOWN);
  });
});

describe('getErrorI18nKey', () => {
  it('returns correct i18n keys', () => {
    expect(getErrorI18nKey(ErrorType.NETWORK)).toBe('errorNetwork');
    expect(getErrorI18nKey(ErrorType.CONNECTION)).toBe('errorNetwork');
    expect(getErrorI18nKey(ErrorType.AUTH)).toBe('errorAuth');
    expect(getErrorI18nKey(ErrorType.VALIDATION)).toBe('errorValidation');
    expect(getErrorI18nKey(ErrorType.NOT_FOUND)).toBe('errorNotFound');
    expect(getErrorI18nKey(ErrorType.RATE_LIMIT)).toBe('errorRateLimit');
    expect(getErrorI18nKey(ErrorType.SERVER)).toBe('errorServer');
    expect(getErrorI18nKey(ErrorType.DOMAIN_BLOCKED)).toBe('errorDomainBlocked');
    expect(getErrorI18nKey(ErrorType.UNKNOWN)).toBe('errorGeneric');
  });
});

describe('getUserMessage', () => {
  it('returns fallback message without i18n', () => {
    expect(getUserMessage(new Error('network error'))).toBe('A network error occurred.');
    expect(getUserMessage(new Error('invalid api key'))).toBe('An authentication error occurred.');
    expect(getUserMessage(new Error('unknown'))).toBe('An error occurred.');
  });

  it('uses i18n getter when provided', () => {
    const i18n = vi.fn((key: string) => `i18n:${key}`);
    expect(getUserMessage(new Error('network error'), i18n)).toBe('i18n:errorNetwork');
    expect(i18n).toHaveBeenCalledWith('errorNetwork');
  });

  it('falls back to default message when i18n returns empty string', () => {
    const i18n = vi.fn(() => '');
    expect(getUserMessage(new Error('network error'), i18n)).toBe('A network error occurred.');
  });
});

describe('convertKnownErrorMessage', () => {
  it('returns generic message for empty/non-string input', () => {
    expect(convertKnownErrorMessage('')).toBe('An error occurred.');
    expect(convertKnownErrorMessage(null as any)).toBe('An error occurred.');
  });

  it('matches known patterns', () => {
    expect(convertKnownErrorMessage('URL is not allowed')).toBe('Error: /url.*not allowed/i');
    expect(convertKnownErrorMessage('Domain blocked')).toBe('Error: /domain.*block/i');
    expect(convertKnownErrorMessage('URL invalid')).toBe('Error: /url.*invalid/i');
    expect(convertKnownErrorMessage('Obsidian connection failed')).toBe('Error: /obsidian.*connection/i');
    expect(convertKnownErrorMessage('Daily note not found')).toBe('Error: /daily note/i');
    expect(convertKnownErrorMessage('AI summarization failed')).toBe('Error: /ai.*summar/i');
    expect(convertKnownErrorMessage('Content is empty')).toBe('Error: /content.*empty/i');
  });

  it('uses i18n getter when provided for known patterns', () => {
    const i18n = vi.fn((key: string) => `i18n:${key}`);
    expect(convertKnownErrorMessage('URL is not allowed', i18n)).toBe('i18n:errorUrlNotAllowed');
  });

  it('falls back to classification for unmatched messages', () => {
    expect(convertKnownErrorMessage('network error')).toBe('A network error occurred.');
  });
});

describe('createErrorResponse', () => {
  it('creates error response with user message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = createErrorResponse(new Error('network error'), { url: 'https://example.com' });

    expect(response.success).toBe(false);
    expect(response.errorType).toBe(ErrorType.NETWORK);
    expect(response.error).toBe('A network error occurred.');
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('creates error response for non-Error values', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = createErrorResponse({ message: 'network error' });

    expect(response.success).toBe(false);
    expect(response.errorType).toBe(ErrorType.NETWORK);

    consoleErrorSpy.mockRestore();
  });
});
