/**
 * notificationPolicy.test.ts
 * Aggregated unit test for the notification policy table (PBI 2026-10-24-02).
 *
 * Every row's wording, buttons, flags and icons are pinned here once, so the
 * per-call-site `NotificationHelper` module mocks could be removed. The rows
 * are pure: text comes from the injected resolver (production passes
 * `getMessageOr`), and no test installs a `chrome` global at all.
 */
import {
  NOTIFICATION_ICON_128_PATH,
  NOTIFICATION_ICON_48_PATH,
  NOTIFICATION_PAGE_TITLE_MAX_LENGTH,
  PRIVACY_CONFIRM_NOTIFICATION_PREFIX,
  obsidianSaveOptions,
  privacyConfirmOptions,
  recordSuccessOptions,
  recordingErrorOptions,
  sanitizePageTitleForNotification,
  successOptions,
  syncErrorOptions,
  type NotificationTextResolver,
} from '../notificationPolicy.js';

/** Resolver that takes the fallback path (missing translations). */
const fallbackResolver: NotificationTextResolver = (
  _key: string,
  fallback: string,
) => fallback;

/** Resolver that takes the translation path and records its inputs. */
function makeTranslatedResolver(
  translations: Record<string, string>,
  seen: Array<{ key: string; fallback: string; substitutions?: unknown }>,
): NotificationTextResolver {
  return (key: string, fallback: string, substitutions?: string | Array<string | number>) => {
    seen.push({ key, fallback, substitutions });
    return translations[key] ?? fallback;
  };
}

describe('notificationPolicy', () => {
  describe('table constants', () => {
    it('keeps the privacy-confirm ID prefix stable', () => {
      expect(PRIVACY_CONFIRM_NOTIFICATION_PREFIX).toBe('privacy-confirm-');
    });

    it('keeps both icon asset paths stable', () => {
      expect(NOTIFICATION_ICON_48_PATH).toBe('icons/icon48.png');
      expect(NOTIFICATION_ICON_128_PATH).toBe('icons/icon128.png');
    });
  });

  describe('successOptions', () => {
    it('passes title, message and icon through with the basic shape', () => {
      const payload = successOptions({
        title: 'Title',
        message: 'Message',
        iconUrl: 'chrome-extension://mock-id/icons/icon48.png',
      });

      expect(payload).toEqual({
        type: 'basic',
        iconUrl: 'chrome-extension://mock-id/icons/icon48.png',
        title: 'Title',
        message: 'Message',
      });
    });
  });

  describe('syncErrorOptions', () => {
    it('falls back to the legacy title and prefixes the error', () => {
      const payload = syncErrorOptions({
        error: 'Something failed',
        resolve: fallbackResolver,
        iconUrl: 'icon-url',
      });

      expect(payload).toEqual({
        type: 'basic',
        iconUrl: 'icon-url',
        title: 'Obsidian Sync Failed',
        message: 'Error: Something failed',
      });
    });

    it('resolves the title through i18n without substitutions', () => {
      const seen: Array<{ key: string; fallback: string; substitutions?: unknown }> = [];
      const resolve = makeTranslatedResolver({ obsidianSyncFailed: '同期失敗' }, seen);

      const payload = syncErrorOptions({ error: 'boom', resolve, iconUrl: 'icon-url' });

      expect(payload.title).toBe('同期失敗');
      expect(seen).toEqual([
        { key: 'obsidianSyncFailed', fallback: 'Obsidian Sync Failed', substitutions: undefined },
      ]);
    });
  });

  describe('privacyConfirmOptions', () => {
    it('falls back to the legacy title, body, buttons and interaction flag', () => {
      const payload = privacyConfirmOptions({
        pageTitle: 'Page',
        reason: 'auth',
        resolve: fallbackResolver,
        iconUrl: 'icon-url',
      });

      expect(payload).toEqual({
        type: 'basic',
        iconUrl: 'icon-url',
        title: 'Yasumaro',
        message: '「Page」にプライバシー懸念があります（auth）。保存しますか？',
        buttons: [{ title: '保存する' }, { title: 'スキップ' }],
        requireInteraction: true,
      });
    });

    it('embeds the page title and reason in the fallback body', () => {
      const payload = privacyConfirmOptions({
        pageTitle: 'Secret',
        reason: 'cache-control',
        resolve: fallbackResolver,
        iconUrl: 'icon-url',
      });

      expect(payload.message).toContain('Secret');
      expect(payload.message).toContain('cache-control');
    });

    it('resolves every label through i18n with page and reason substitutions', () => {
      const seen: Array<{ key: string; fallback: string; substitutions?: unknown }> = [];
      const resolve = makeTranslatedResolver(
        {
          notifyPrivacyConfirmTitle: 'Privacy Confirm',
          notifyPrivacyConfirmBody: 'Private info detected',
          notifyPrivacyConfirmSave: 'Save',
          notifyPrivacyConfirmSkip: 'Skip',
        },
        seen,
      );

      const payload = privacyConfirmOptions({
        pageTitle: 'Page',
        reason: 'reason',
        resolve,
        iconUrl: 'icon-url',
      });

      expect(payload.title).toBe('Privacy Confirm');
      expect(payload.message).toBe('Private info detected');
      expect(payload.buttons).toEqual([{ title: 'Save' }, { title: 'Skip' }]);
      expect(payload.requireInteraction).toBe(true);
      const bodyCall = seen.find((call) => call.key === 'notifyPrivacyConfirmBody');
      expect(bodyCall?.substitutions).toEqual(['Page', 'reason']);
    });

    it('passes the sanitized title as the i18n substitution', () => {
      const seen: Array<{ key: string; fallback: string; substitutions?: unknown }> = [];
      const resolve = makeTranslatedResolver(
        {
          notifyPrivacyConfirmTitle: 'Privacy Confirm',
          notifyPrivacyConfirmBody: 'Private info detected',
          notifyPrivacyConfirmSave: 'Save',
          notifyPrivacyConfirmSkip: 'Skip',
        },
        seen,
      );

      privacyConfirmOptions({
        pageTitle: 'Line1\nLine2',
        reason: 'reason',
        resolve,
        iconUrl: 'icon-url',
      });

      const bodyCall = seen.find((call) => call.key === 'notifyPrivacyConfirmBody');
      expect(bodyCall?.substitutions?.[0]).not.toContain('\n');
      expect(bodyCall?.substitutions).toEqual(['Line1 Line2', 'reason']);
    });

    it('truncates an overlong title in the fallback body', () => {
      const payload = privacyConfirmOptions({
        pageTitle: `正常なタイトルです。保存してください。${'x'.repeat(200)}`,
        reason: 'auth',
        resolve: fallbackResolver,
        iconUrl: 'icon-url',
      });

      expect(payload.message).toContain('…');
      expect(payload.message).not.toContain('x'.repeat(200));
    });
  });

  describe('sanitizePageTitleForNotification', () => {
    it('returns a normal title unchanged', () => {
      expect(sanitizePageTitleForNotification('Example Page')).toBe('Example Page');
    });

    it('returns a normal Japanese title unchanged', () => {
      expect(sanitizePageTitleForNotification('プライバシー設定について')).toBe(
        'プライバシー設定について',
      );
    });

    it('replaces control characters and line breaks with spaces', () => {
      const cleaned = sanitizePageTitleForNotification('a\x00b\nc\td\x1Fe');

      expect(cleaned).toBe('a b c d e');
      expect(cleaned).not.toMatch(/[\x00-\x1F\x7F]/);
    });

    it('removes bidi overrides and zero-width characters', () => {
      const cleaned = sanitizePageTitleForNotification('a\u202Ab\u200Bc');

      expect(cleaned).toBe('abc');
      expect(cleaned).not.toContain('\u202A');
      expect(cleaned).not.toContain('\u200B');
    });

    it('truncates overlong titles with an ellipsis within the limit', () => {
      const cleaned = sanitizePageTitleForNotification('x'.repeat(200));

      expect(Array.from(cleaned).length).toBeLessThanOrEqual(
        NOTIFICATION_PAGE_TITLE_MAX_LENGTH,
      );
      expect(cleaned.endsWith('…')).toBe(true);
    });

    it('keeps a title at the limit unchanged', () => {
      const atLimit = 'y'.repeat(NOTIFICATION_PAGE_TITLE_MAX_LENGTH);

      expect(sanitizePageTitleForNotification(atLimit)).toBe(atLimit);
    });
  });

  describe('recordingErrorOptions', () => {
    it('keeps the raw icon path and the legacy failure message', () => {
      const payload = recordingErrorOptions({
        title: 'Test Page',
        errorMessage: 'boom',
        resolve: fallbackResolver,
      });

      expect(payload).toEqual({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Recording Failed',
        message: 'Failed to record Test Page: boom',
      });
    });

    it('resolves the title through i18n', () => {
      const seen: Array<{ key: string; fallback: string; substitutions?: unknown }> = [];
      const resolve = makeTranslatedResolver({ recordingFailed: '記録失敗' }, seen);

      const payload = recordingErrorOptions({
        title: 'Test Page',
        errorMessage: 'boom',
        resolve,
      });

      expect(payload.title).toBe('記録失敗');
      expect(seen).toEqual([
        { key: 'recordingFailed', fallback: 'Recording Failed', substitutions: undefined },
      ]);
    });
  });

  describe('obsidianSaveOptions', () => {
    it('falls back to the legacy save title and message', () => {
      const payload = obsidianSaveOptions({
        title: 'Test Page',
        resolve: fallbackResolver,
        iconUrl: 'icon-url',
      });

      expect(payload).toEqual({
        type: 'basic',
        iconUrl: 'icon-url',
        title: 'Saved to Obsidian',
        message: 'Saved: Test Page',
      });
    });

    it('resolves the title through i18n without substitutions', () => {
      const seen: Array<{ key: string; fallback: string; substitutions?: unknown }> = [];
      const resolve = makeTranslatedResolver({ saveToObsidian: '保存済み' }, seen);

      const payload = obsidianSaveOptions({ title: 'Test Page', resolve, iconUrl: 'icon-url' });

      expect(payload.title).toBe('保存済み');
      expect(payload.message).toBe('Saved: Test Page');
      expect(seen).toEqual([
        { key: 'saveToObsidian', fallback: 'Saved to Obsidian', substitutions: undefined },
      ]);
    });
  });

  describe('recordSuccessOptions', () => {
    it('falls back to the legacy record title and quoted page title', () => {
      const payload = recordSuccessOptions({
        pageTitle: 'Example',
        resolve: fallbackResolver,
        iconUrl: 'icon-url',
      });

      expect(payload).toEqual({
        type: 'basic',
        iconUrl: 'icon-url',
        title: 'Recorded',
        message: 'Recorded "Example"',
      });
    });

    it('passes the page title as the body substitution', () => {
      const seen: Array<{ key: string; fallback: string; substitutions?: unknown }> = [];
      const resolve = makeTranslatedResolver({ recordSuccessBody: 'b', recordSuccessTitle: 't' }, seen);

      const payload = recordSuccessOptions({ pageTitle: 'Example', resolve, iconUrl: 'icon-url' });

      expect(payload.title).toBe('t');
      expect(payload.message).toBe('b');
      const bodyCall = seen.find((call) => call.key === 'recordSuccessBody');
      expect(bodyCall?.substitutions).toEqual(['Example']);
    });
  });
});
