/**
 * notificationPolicy.ts
 *
 * Single owner of every notification payload (PBI 2026-10-24-02).
 *
 * Six call sites used to inline their own wording, button labels,
 * requireInteraction flags and icon paths next to a direct
 * `chrome.notifications.create` call (NotificationHelper's 3 static methods
 * plus resultBuilder's 2 notifier adapters). Changing one sentence meant
 * editing a method and updating every per-call-site mock.
 *
 * The table below owns the POLICY (text, buttons, flags, icon) as pure data:
 * each row is a function of explicit inputs plus a text resolver, with no
 * `chrome.*` access. The single write point (`NotificationHelper.show`)
 * performs the only `chrome.notifications.create` call. Follows the
 * `badgePolicy.ts`流儀: pure `badgeDisplay(state)` table + single `setBadge`
 * write point.
 *
 * Payload parity is byte-exact with the pre-table behavior; the table unit
 * test pins every row including the i18n fallbacks.
 */

/** Notification ID prefix for privacy confirmation notifications. */
export const PRIVACY_CONFIRM_NOTIFICATION_PREFIX = 'privacy-confirm-';

/** Icon asset paths carried by the policy rows (SSOT for both writers). */
export const NOTIFICATION_ICON_48_PATH = 'icons/icon48.png';
export const NOTIFICATION_ICON_128_PATH = 'icons/icon128.png';

/** Maximum length (in code points) of a page-derived title inside a notification. */
export const NOTIFICATION_PAGE_TITLE_MAX_LENGTH = 80;

/**
 * Sanitizes an attacker-controlled page title before it reaches the trusted
 * notification surface (PBI 2026-11-08-03). `sender.tab.title` is page
 * content, while the notification chrome carries the extension's trust, so
 * raw interpolation lets a page inject誘導文言 into a trusted prompt.
 *
 * - Control characters (CR/LF/TAB and other Cc controls) become spaces, so
 *   line-break injection cannot forge extra notification lines.
 * - Bidi overrides, zero-width characters and other invisible formatting
 *   marks are removed, so visual spoofing cannot reorder or hide the text.
 * - Overlong titles are truncated with a trailing "…" so a page cannot push
 *   the real question out of view.
 * - The policy templates already quote the title (「」/""), marking it as
 *   page-derived content.
 *
 * Normal titles pass through byte-identical.
 */
export function sanitizePageTitleForNotification(title: string): string {
  const withoutControls = title
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u2028\u2029\u00AD]/g, '')
    .trim();
  const chars = Array.from(withoutControls);
  if (chars.length <= NOTIFICATION_PAGE_TITLE_MAX_LENGTH) {
    return withoutControls;
  }
  return `${chars.slice(0, NOTIFICATION_PAGE_TITLE_MAX_LENGTH - 1).join('')}…`;
}

/**
 * Resolves user-visible text. Production passes `getMessageOr` (i18n with
 * fallback); tests pass a fake. Matches the `getMessageOr` signature so the
 * wiring is a direct reference without an adapter.
 */
export type NotificationTextResolver = (
  key: string,
  fallback: string,
  substitutions?: string | Array<string | number>,
) => string;

/** One fully-resolved notification payload, ready for the single write point. */
export type NotificationPayload = chrome.notifications.NotificationCreateOptions;

/** Inputs shared by rows that render through the extension icon. */
interface IconPayloadInput {
  iconUrl: string;
}

export function successOptions(
  input: IconPayloadInput & { title: string; message: string },
): NotificationPayload {
  return {
    type: 'basic',
    iconUrl: input.iconUrl,
    title: input.title,
    message: input.message,
  };
}

export function syncErrorOptions(
  input: IconPayloadInput & { error: unknown; resolve: NotificationTextResolver },
): NotificationPayload {
  return {
    type: 'basic',
    iconUrl: input.iconUrl,
    title: input.resolve('obsidianSyncFailed', 'Obsidian Sync Failed'),
    message: `Error: ${input.error}`,
  };
}

export function privacyConfirmOptions(
  input: IconPayloadInput & {
    pageTitle: string;
    reason: string;
    resolve: NotificationTextResolver;
  },
): NotificationPayload {
  // PBI 2026-11-08-03: pageTitle is attacker-controlled (sender.tab.title).
  // Sanitize once here, at the single policy owner, so every caller of the
  // single write point is covered.
  const safePageTitle = sanitizePageTitleForNotification(input.pageTitle);
  return {
    type: 'basic',
    iconUrl: input.iconUrl,
    title: input.resolve('notifyPrivacyConfirmTitle', 'Yasumaro'),
    message: input.resolve(
      'notifyPrivacyConfirmBody',
      `「${safePageTitle}」にプライバシー懸念があります（${input.reason}）。保存しますか？`,
      [safePageTitle, input.reason],
    ),
    buttons: [
      { title: input.resolve('notifyPrivacyConfirmSave', '保存する') },
      { title: input.resolve('notifyPrivacyConfirmSkip', 'スキップ') },
    ],
    requireInteraction: true,
  };
}

/**
 * Pipeline failure notice. Keeps the legacy raw asset path (not the
 * runtime-resolved URL): the pre-table code passed the path through
 * untouched, and the table preserves that byte.
 */
export function recordingErrorOptions(input: {
  title: string;
  errorMessage: string;
  resolve: NotificationTextResolver;
}): NotificationPayload {
  return {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON_128_PATH,
    title: input.resolve('recordingFailed', 'Recording Failed'),
    message: `Failed to record ${input.title}: ${input.errorMessage}`,
  };
}

export function obsidianSaveOptions(
  input: IconPayloadInput & { title: string; resolve: NotificationTextResolver },
): NotificationPayload {
  return {
    type: 'basic',
    iconUrl: input.iconUrl,
    title: input.resolve('saveToObsidian', 'Saved to Obsidian'),
    message: `Saved: ${input.title}`,
  };
}

export function recordSuccessOptions(
  input: IconPayloadInput & { pageTitle: string; resolve: NotificationTextResolver },
): NotificationPayload {
  return {
    type: 'basic',
    iconUrl: input.iconUrl,
    title: input.resolve('recordSuccessTitle', 'Recorded'),
    message: input.resolve('recordSuccessBody', `Recorded "${input.pageTitle}"`, [
      input.pageTitle,
    ]),
  };
}
