/**
 * privacyConsentController.ts
 * プライバシーポリシー同意モーダルUIコントローラー
 */

import { focusTrapManager } from './utils/focusTrap.js';
import { getMessage } from './i18n.js';
import { getPrivacyConsent, savePrivacyConsent, migrateLegacyPrivacyConsent } from './privacyConsent.js';
import { logError, ErrorCode } from '../utils/logger.js';

// DOM Elements (lazily resolved so they work in tests with dynamic imports)
function getModalEl(): HTMLElement | null {
    return document.getElementById('privacyConsentModal');
}
function getViewPolicyBtnEl(): HTMLAnchorElement | null {
    return document.getElementById('viewPrivacyPolicyBtn') as HTMLAnchorElement;
}
function getConsentCheckboxEl(): HTMLInputElement | null {
    return document.getElementById('consentCheckbox') as HTMLInputElement;
}
function getAcceptConsentBtnEl(): HTMLButtonElement | null {
    return document.getElementById('acceptConsentBtn') as HTMLButtonElement;
}
function getDeclineConsentBtnEl(): HTMLButtonElement | null {
    return document.getElementById('declineConsentBtn') as HTMLButtonElement;
}
function getPrivacyConsentTitleEl(): HTMLElement | null {
    return document.getElementById('privacyConsentTitle');
}

// State
let consentTrapId: string | null = null;
let onConsentCallback: ((consented: boolean) => void) | null = null;

/**
 * プライバシーポリシー同意初期化
 */
export async function initPrivacyConsent(): Promise<void> {
    try {
        // 既存ユーザーのマイグレーション
        await migrateLegacyPrivacyConsent();

        const state = await getPrivacyConsent();

        if (!state.hasConsented) {
            // 同意モーダルを表示
            showPrivacyConsentModal();
        }
    } catch (error) {
        logError('[PrivacyConsent] Error in initialization', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }
}

/**
 * 同意モーダルを表示
 */
function showPrivacyConsentModal(): void {
    const modal = getModalEl();
    if (!modal) {
        logError('[PrivacyConsent] Modal element not found', {}, ErrorCode.INTERNAL_ERROR);
        return;
    }

    const cb = getConsentCheckboxEl();
    const acceptBtn = getAcceptConsentBtnEl();
    const policyBtn = getViewPolicyBtnEl();
    const title = getPrivacyConsentTitleEl();

    // 状態リセット
    if (cb) cb.checked = false;
    if (acceptBtn) acceptBtn.disabled = true;

    // プライバシーポリシーリンク設定
    if (policyBtn) {
        policyBtn.href = chrome.runtime.getURL('permissions.html');
        policyBtn.setAttribute(
            'aria-label',
            getMessage('viewFullPolicy') || 'View Full Privacy Policy'
        );
    }

    // 翻訳
    if (title) {
        title.textContent = getMessage('privacyConsentTitle') || 'Privacy Policy Consent';
    }

    // モーダル表示
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    void modal.offsetHeight; // リフロー強制
    modal.classList.add('show');

    // フォーカストラップ設定（ESCで閉じない）
    consentTrapId = focusTrapManager.trap(modal, () => {
        // ESC押下時は何もしない（同意が必要）
    });

    // チェックボックスにフォーカス
    cb?.focus();
}

/**
 * 同意モーダルを非表示にする
 */
function hidePrivacyConsentModal(): void {
    const modal = getModalEl();
    if (!modal) return;

    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.classList.add('hidden');

    // フォーカストラップ解放
    if (consentTrapId) {
        focusTrapManager.release(consentTrapId);
        consentTrapId = null;
    }

    // 状態リセット
    const cb = getConsentCheckboxEl();
    const acceptBtn = getAcceptConsentBtnEl();
    if (cb) cb.checked = false;
    if (acceptBtn) acceptBtn.disabled = true;
}

/**
 * 同意ボタンハンドラー
 */
async function handleAcceptConsent(): Promise<void> {
    try {
        await savePrivacyConsent();
        hidePrivacyConsentModal();

        if (onConsentCallback) {
            onConsentCallback(true);
            onConsentCallback = null;
        }
    } catch (error) {
        logError('[PrivacyConsent] Failed to save consent', { cause: error }, ErrorCode.INTERNAL_ERROR);

        // エラー表示
        const acceptBtn = getAcceptConsentBtnEl();
        if (acceptBtn) {
            const originalText = acceptBtn.textContent;
            acceptBtn.textContent = getMessage('saveFailed') || 'Failed to save consent';
            setTimeout(() => {
                acceptBtn.textContent = originalText;
            }, 2000);
        }
    }
}

/**
 * 拒否ボタンハンドラー
 */
async function handleDeclineConsent(): Promise<void> {
    hidePrivacyConsentModal();

    // 同意が必要であることを通知
    const message = getMessage('consentRequired') ||
        'Privacy consent is required to use this extension.';
    alert(message);

    // モーダルを再表示（同意が必要）
    setTimeout(() => {
        showPrivacyConsentModal();
    }, 100);

    if (onConsentCallback) {
        onConsentCallback(false);
        onConsentCallback = null;
    }
}

/**
 * イベントリスナー設定
 */
export function setupPrivacyConsentListeners(): void {
    const cb = getConsentCheckboxEl();
    const acceptBtn = getAcceptConsentBtnEl();
    const declineBtn = getDeclineConsentBtnEl();
    const modal = getModalEl();
    const policyBtn = getViewPolicyBtnEl();

    // チェックボックスでAcceptボタン有効化
    if (cb && acceptBtn) {
        cb.addEventListener('change', () => {
            acceptBtn.disabled = !cb.checked;
        });
    }

    // Acceptボタン
    if (acceptBtn) {
        acceptBtn.addEventListener('click', handleAcceptConsent);
    }

    // Declineボタン
    if (declineBtn) {
        declineBtn.addEventListener('click', handleDeclineConsent);
    }

    // 外部クリックで閉じない（明示的なアクションを要求）
    if (modal) {
        modal.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
        });
    }

    // 新しいタブでプライバシーポリシーを開く
    if (policyBtn) {
        policyBtn.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault();
            chrome.tabs.create({ url: policyBtn.href });
        });
    }
}

/**
 * テスト用コールバック設定
 */
export function setConsentCallback(callback: (consented: boolean) => void): void {
    onConsentCallback = callback;
}