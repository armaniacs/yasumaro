// @vitest-environment jsdom
/**
 * historyUtils.test.ts
 * Unit tests for historyUtils.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Setup chrome mock
vi.stubGlobal('chrome', {
    i18n: {
        getMessage: vi.fn((key: string) => {
            // Return a default message for recordError, otherwise return key
            const messages: Record<string, string> = {
                recordError: 'Recording failed',
            };
            return messages[key] || 'fallback message';
        }),
        getUILanguage: vi.fn(() => 'en'),
    },
    runtime: {
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
    },
    storage: {
        local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
        },
    },
});

import {
    createPaginationControls,
    showRecordError,
    checkServiceWorkerAlive,
} from '../historyUtils.js';

describe('createPaginationControls', () => {
    it('creates pagination element with prev/next buttons', () => {
        const onPageChange = vi.fn();
        const nav = createPaginationControls(0, 5, onPageChange);

        expect(nav.className).toBe('pending-pagination');
        expect(nav.querySelectorAll('button').length).toBe(2);
    });

    it('disables prev button on first page', () => {
        const onPageChange = vi.fn();
        const nav = createPaginationControls(0, 5, onPageChange);

        const prevBtn = nav.querySelector('button:first-child');
        expect(prevBtn?.disabled).toBe(true);
    });

    it('disables next button on last page', () => {
        const onPageChange = vi.fn();
        const nav = createPaginationControls(4, 5, onPageChange);

        const nextBtn = nav.querySelector('button:last-child');
        expect(nextBtn?.disabled).toBe(true);
    });

    it('enables both buttons on middle page', () => {
        const onPageChange = vi.fn();
        const nav = createPaginationControls(2, 5, onPageChange);

        const buttons = nav.querySelectorAll('button');
        expect(buttons[0]?.disabled).toBe(false);
        expect(buttons[1]?.disabled).toBe(false);
    });

    it('displays correct page info', () => {
        const onPageChange = vi.fn();
        const nav = createPaginationControls(2, 5, onPageChange);

        const pageInfo = nav.querySelector('.pending-page-info');
        expect(pageInfo?.textContent).toBe('3 / 5');
    });

    it('calls onPageChange with previous page when prev clicked', () => {
        const onPageChange = vi.fn();
        const nav = createPaginationControls(2, 5, onPageChange);

        const prevBtn = nav.querySelector('button:first-child') as HTMLButtonElement;
        prevBtn.click();

        expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('calls onPageChange with next page when next clicked', () => {
        const onPageChange = vi.fn();
        const nav = createPaginationControls(2, 5, onPageChange);

        const nextBtn = nav.querySelector('button:last-child') as HTMLButtonElement;
        nextBtn.click();

        expect(onPageChange).toHaveBeenCalledWith(3);
    });
});

describe('showRecordError', () => {
    it('displays error message in element', () => {
        const container = document.createElement('div');
        const error = new Error('Test error message');
        showRecordError(container, error);

        const errorEl = container.querySelector('.record-error-message');
        expect(errorEl?.textContent).toBe('Test error message');
    });

    it('displays error from object with error property', () => {
        const container = document.createElement('div');
        const error = { error: 'Object error message' };
        showRecordError(container, error);

        const errorEl = container.querySelector('.record-error-message');
        expect(errorEl?.textContent).toBe('Object error message');
    });

    it('displays default message for unknown error', () => {
        const container = document.createElement('div');
        showRecordError(container, null);

        const errorEl = container.querySelector('.record-error-message');
        expect(errorEl?.textContent).toBe('Recording failed');
    });

    it('removes error message after timeout', async () => {
        vi.useFakeTimers();
        const container = document.createElement('div');
        const error = new Error('Test error');
        showRecordError(container, error);

        const errorEl = container.querySelector('.record-error-message');
        expect(errorEl).toBeTruthy();

        vi.advanceTimersByTime(6000);
        expect(container.querySelector('.record-error-message')).toBeFalsy();

        vi.useRealTimers();
    });
});

describe('checkServiceWorkerAlive', () => {
    it('returns true when service worker responds with success', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ success: true });
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        const result = await checkServiceWorkerAlive();

        expect(result).toBe(true);
        expect(sendMessage).toHaveBeenCalledWith({ type: 'PING' });
    });

    it('returns false when service worker throws error', async () => {
        const sendMessage = vi.fn().mockRejectedValue(new Error('Service worker not available'));
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        const result = await checkServiceWorkerAlive();

        expect(result).toBe(false);
    });

    it('returns false when response does not have success flag', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ success: false });
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        const result = await checkServiceWorkerAlive();

        expect(result).toBe(false);
    });
});
