/**
 * privacyConsentController.ts
 * プライバシーポリシー同意モーダルUIコントローラー
 */

import { focusTrapManager } from './utils/focusTrap.js';
import { getMessage } from './i18n.js';
import { getPrivacyConsent, savePrivacyConsent, migrateLegacyPrivacyConsent } from './privacyConsent.js';

// DOM Elements
const privacyConsentModal = document.getElementById('privacyConsentModal') as HTMLElement;
const viewPrivacyPolicyBtn = document.getElementById('viewPrivacyPolicyBtn') as HTMLAnchorElement;
const consentCheckbox = document.getElementById('consentCheckbox') as HTMLInputElement;
const acceptConsentBtn = document.getElementById('acceptConsentBtn') as HTMLButtonElement;
const declineConsentBtn = document.getElementById('declineConsentBtn') as HTMLButtonElement;
const privacyConsentTitle = document.getElementById('privacyConsentTitle') as HTMLElement;

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
        console.error('[PrivacyConsent] Error in initialization:', error);
    }
}

/**
 * 同意モーダルを表示
 */
function showPrivacyConsentModal(): void {
    if (!privacyConsentModal) {
        console.error('[PrivacyConsent] Modal element not found');
        return;
    }

    // 状態リセット
    if (consentCheckbox) consentCheckbox.checked = false;
    if (acceptConsentBtn) acceptConsentBtn.disabled = true;

    // プライバシーポリシーリンク設定
    if (viewPrivacyPolicyBtn) {
        viewPrivacyPolicyBtn.href = chrome.runtime.getURL('privacy/privacy.html');
        viewPrivacyPolicyBtn.setAttribute(
            'aria-label',
            getMessage('viewFullPolicy') || 'View Full Privacy Policy'
        );
    }

    // 翻訳
    if (privacyConsentTitle) {
        privacyConsentTitle.textContent = getMessage('privacyConsentTitle') || 'Privacy Policy Consent';
    }

    // モーダル表示
    privacyConsentModal.classList.remove('hidden');
    privacyConsentModal.style.display = 'flex';
    void privacyConsentModal.offsetHeight; // リフロー強制
    privacyConsentModal.classList.add('show');

    // フォーカストラップ設定（ESCで閉じない）
    consentTrapId = focusTrapManager.trap(privacyConsentModal, () => {
        // ESC押下時は何もしない（同意が必要）
    });

    // チェックボックスにフォーカス
    consentCheckbox?.focus();
}

/**
 * 同意モーダルを非表示にする
 */
function hidePrivacyConsentModal(): void {
    if (!privacyConsentModal) return;

    privacyConsentModal.classList.remove('show');
    privacyConsentModal.style.display = 'none';
    privacyConsentModal.classList.add('hidden');

    // フォーカストラップ解放
    if (consentTrapId) {
        focusTrapManager.release(consentTrapId);
        consentTrapId = null;
    }

    // 状態リセット
    if (consentCheckbox) consentCheckbox.checked = false;
    if (acceptConsentBtn) acceptConsentBtn.disabled = true;
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
        console.error('[PrivacyConsent] Failed to save consent:', error);

        // エラー表示
        if (acceptConsentBtn) {
            const originalText = acceptConsentBtn.textContent;
            acceptConsentBtn.textContent = getMessage('saveFailed') || 'Failed to save consent';
            setTimeout(() => {
                acceptConsentBtn.textContent = originalText;
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
    // チェックボックスでAcceptボタン有効化
    if (consentCheckbox && acceptConsentBtn) {
        consentCheckbox.addEventListener('change', () => {
            acceptConsentBtn.disabled = !consentCheckbox.checked;
        });
    }

    // Acceptボタン
    if (acceptConsentBtn) {
        acceptConsentBtn.addEventListener('click', handleAcceptConsent);
    }

    // Declineボタン
    if (declineConsentBtn) {
        declineConsentBtn.addEventListener('click', handleDeclineConsent);
    }

    // 外部クリックで閉じない（明示的なアクションを要求）
    if (privacyConsentModal) {
        privacyConsentModal.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
        });
    }

    // 新しいタブでプライバシーポリシーを開く
    if (viewPrivacyPolicyBtn) {
        viewPrivacyPolicyBtn.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault();
            chrome.tabs.create({ url: viewPrivacyPolicyBtn.href });
        });
    }
}

/**
 * テスト用コールバック設定
 */
export function setConsentCallback(callback: (consented: boolean) => void): void {
    onConsentCallback = callback;
}