/**
 * sessionLockGuard.ts
 * PBI 2026-11-23-03: ロック中の初期設定画面の無効化表示。
 *
 * マスターパスワード有効かつロック中 (authGuard.isLocked) のとき、
 * 初期設定パネル (#panel-general) の API キー欄と保存操作を無効化し、
 * アンロック導線 (Privacy パネルへの移動ボタン付き案内) と
 * 設定順序 (APIキー登録 → 疎通確認 → 保護有効化) を表示する。
 *
 * 文言は新規ロケールキーを作らず、既存キー
 * `encryptionLockedApiKeys` を getMessageOr のフォールバック付きで使う
 * (他PBIと並列作業中のため locales には触らない)。
 * SW 側は無改修: このモジュールは表示制御のみで復号には触れない。
 */

import { isLocked as readSessionLock } from '../../utils/storage/authGuard.js';
import { getMessageOr } from '../../utils/i18n.js';

/** ロック案内バナーの DOM id (テスト観測点)。 */
export const SESSION_LOCK_NOTICE_ID = 'sessionLockNotice';

/** アンロック導線ボタンの DOM id (テスト観測点)。 */
export const SESSION_LOCK_UNLOCK_BUTTON_ID = 'sessionLockUnlockBtn';

/** 保存不可の文言 (3点統一の1点目)。 */
export const LOCK_SAVE_FALLBACK =
  'Locked: API key fields and Save are disabled while the master password session is locked. Unlock in the Privacy panel first.';

/** AI 利用不可の文言 (3点統一の2点目)。 */
export const LOCK_AI_FALLBACK =
  'Locked: the AI test is unavailable while the master password session is locked. Unlock in the Privacy panel first.';

/** 設定順序の案内 (初期設定画面と文書で同一)。 */
export const LOCK_SETUP_ORDER_FALLBACK =
  'Setup order: 1 register the API key, 2 verify with Test, 3 enable protection last.';

/**
 * ロック案内の表示文。保存不可 + 設定順序を1文にまとめ、
 * 既存ロケール文があればそちらを優先する。
 */
export function lockNoticeText(): string {
  return `${getMessageOr('encryptionLockedApiKeys', LOCK_SAVE_FALLBACK)} ${LOCK_SETUP_ORDER_FALLBACK}`;
}

/** API キー欄の判定: data-storage-key が api_key で終わる input。 */
function isApiKeyInput(el: Element): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    (el.getAttribute('data-storage-key') ?? '').endsWith('api_key')
  );
}

/** パネル内の API キー欄を集める。 */
export function collectApiKeyInputs(root: ParentNode): HTMLInputElement[] {
  return [...root.querySelectorAll('input[data-storage-key]')].filter(isApiKeyInput);
}

/** パネル内の保存ボタン (#save / #saveTop) を集める。 */
export function collectSaveButtons(root: ParentNode): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  for (const selector of ['#save', '#saveTop']) {
    const found = root.querySelector<HTMLButtonElement>(selector);
    if (found) buttons.push(found);
  }
  return buttons;
}

/**
 * アンロック導線: Privacy パネルへ移動する。
 * DOM レベルの遷移 (サイドバーボタンのクリック) のみで、
 * panels 層への import は持たない。サイドバーが無い文脈 (単体テスト等)
 * では hash フォールバックに倒す。
 */
function navigateToPrivacyPanel(): void {
  const privacyButton = document.querySelector<HTMLButtonElement>(
    'button.sidebar-nav-btn[data-panel="panel-privacy"]',
  );
  if (privacyButton) {
    privacyButton.click();
    return;
  }
  try {
    window.location.hash = '#panel-privacy';
  } catch {
    // テスト用 DOM 等で location が書けない場合は何もしない。
  }
}

/**
 * ロック案内バナーを用意する。既存があれば再利用し、無ければ
 * パネル先頭に作る。innerHTML は使わない (check-innerhtml-escape)。
 */
export function ensureSessionLockNotice(container: HTMLElement): HTMLElement {
  const existing = container.querySelector<HTMLElement>(`#${SESSION_LOCK_NOTICE_ID}`);
  if (existing) return existing;

  const notice = document.createElement('div');
  notice.id = SESSION_LOCK_NOTICE_ID;
  notice.className = 'warning-banner';
  notice.setAttribute('role', 'status');

  const message = document.createElement('p');
  message.textContent = lockNoticeText();
  notice.appendChild(message);

  const unlockButton = document.createElement('button');
  unlockButton.id = SESSION_LOCK_UNLOCK_BUTTON_ID;
  unlockButton.type = 'button';
  unlockButton.className = 'secondary-btn';
  unlockButton.textContent = getMessageOr(
    'masterPasswordProtection',
    'Master Password Protection',
  );
  unlockButton.addEventListener('click', navigateToPrivacyPanel);
  notice.appendChild(unlockButton);

  container.prepend(notice);
  return notice;
}

/**
 * パネルにロック状態を反映する。locked=true で API キー欄と保存操作を
 * 無効化し案内を表示、false で全て元に戻す。保存要求自体は出さない
 * (見た目だけの無効化にしない): 実際の抑止は connectionTests 側の
 * ゲートが行う。
 */
export function applySessionLockToPanel(root: ParentNode, locked: boolean): void {
  for (const input of collectApiKeyInputs(root)) {
    input.disabled = locked;
  }
  for (const button of collectSaveButtons(root)) {
    button.disabled = locked;
  }

  const host = root instanceof HTMLElement ? root : document.getElementById('panel-general');
  if (!host) return;
  if (locked) {
    const notice = ensureSessionLockNotice(host);
    // 文言はロック時点のロケールで作り直す (初回表示と言語切替の両対応)。
    const message = notice.querySelector('p');
    if (message) message.textContent = lockNoticeText();
    notice.hidden = false;
  } else {
    const notice = host.querySelector<HTMLElement>(`#${SESSION_LOCK_NOTICE_ID}`);
    if (notice) notice.hidden = true;
  }
}

/** authGuard 読みの安全版: 読み失敗時は未ロック扱い (未設定利用者を止めない)。 */
export async function readSessionLockSafe(
  read: () => Promise<boolean> = readSessionLock,
): Promise<boolean> {
  try {
    return await read();
  } catch {
    return false;
  }
}

/**
 * authGuard.isLocked を読んでパネルに反映し、結果を返す。
 * 依存注入でテスト容易性を保つ (既定は本物の isLocked)。
 */
export async function refreshSessionLockState(
  root: ParentNode = document,
  read: () => Promise<boolean> = readSessionLock,
): Promise<boolean> {
  const locked = await readSessionLockSafe(read);
  applySessionLockToPanel(root, locked);
  return locked;
}
