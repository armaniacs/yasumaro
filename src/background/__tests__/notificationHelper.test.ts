// src/background/__tests__/notificationHelper.test.ts
import { NotificationHelper, PRIVACY_CONFIRM_NOTIFICATION_PREFIX } from '../notificationHelper.js';
import { vi } from 'vitest';

// chrome API モック
const mockCreate = vi.fn();
const mockGetMessage = vi.fn((key: string) => {
    const msgs: Record<string, string> = {
        'obsidianSyncFailed': 'Obsidian Sync Failed',
        'notifyPrivacyConfirmSave': 'Save',
        'notifyPrivacyConfirmSkip': 'Skip',
        'notifyPrivacyConfirmTitle': 'Privacy Confirm',
        'notifyPrivacyConfirmBody': 'Private info detected'
    };
    return msgs[key] || '';
});
(global as any).chrome = {
    runtime: { getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`) },
    notifications: { create: mockCreate },
    i18n: { getMessage: mockGetMessage }
};

describe('NotificationHelper', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    describe('PRIVACY_CONFIRM_NOTIFICATION_PREFIX', () => {
        test('正しいプレフィックス', () => {
            expect(PRIVACY_CONFIRM_NOTIFICATION_PREFIX).toBe('privacy-confirm-');
        });
    });

    describe('getIconUrl', () => {
        test('アイコンURLを返す', () => {
            const url = NotificationHelper.getIconUrl();
            expect(url).toBe('chrome-extension://mock-id/icons/icon48.png');
        });
    });

    describe('notifySuccess', () => {
        test('成功通知を作成する', () => {
            NotificationHelper.notifySuccess('Title', 'Message');
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'basic', title: 'Title', message: 'Message',
                    iconUrl: 'chrome-extension://mock-id/icons/icon48.png'
                })
            );
        });
    });

    describe('notifyError', () => {
        test('エラー通知を作成する', () => {
            NotificationHelper.notifyError('Something failed');
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'basic', message: 'Error: Something failed',
                    title: 'Obsidian Sync Failed'
                })
            );
        });

        test('i18n空の場合はフォールバックタイトル', () => {
            mockGetMessage.mockReturnValue('');
            NotificationHelper.notifyError('err');
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Obsidian Sync Failed' })
            );
        });
    });

    describe('notifyPrivacyConfirm', () => {
        test('確認通知を作成する', () => {
            NotificationHelper.notifyPrivacyConfirm('test-id', 'Page', 'auth');
            expect(mockCreate).toHaveBeenCalledWith(
                'test-id',
                expect.objectContaining({
                    type: 'basic', requireInteraction: true,
                    buttons: [
                        { title: '保存する' },
                        { title: 'スキップ' }
                    ]
                })
            );
        });

        test('ページタイトルがコンテキストメッセージ', () => {
            NotificationHelper.notifyPrivacyConfirm('id', 'Secret', 'auth');
            const opts = mockCreate.mock.calls[0][1];
            expect(opts.message).toContain('Secret');
        });

        test('i18n空の場合はフォールバック', () => {
            mockGetMessage.mockReturnValue('');
            NotificationHelper.notifyPrivacyConfirm('id', 'Page', 'reason');
            const opts = mockCreate.mock.calls[0][1];
            expect(opts.title).toBe('Obsidian Weave');
            expect(opts.buttons[0].title).toBe('保存する');
            expect(opts.buttons[1].title).toBe('スキップ');
        });
    });
});
