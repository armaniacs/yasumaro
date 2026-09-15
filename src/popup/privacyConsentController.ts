/**
 * privacyConsentController.ts
 * プライバシーポリシー同意モーダルUIコントローラー
 */

import { getMessage } from '../utils/i18n.js';
import {
    shouldPromptForConsent,
    acceptConsent,
    declineConsent,
} from '../utils/storage/privacyConsent.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { focusTrapManager } from '../utils/ui/focusTrap.js';

// DOM Elements (lazily resolved so they work in tests with dynamic imports)
function getModalEl(): HTMLDialogElement | null {
    return document.getElementById('privacyConsentModal') as HTMLDialogElement | null;
}
function getViewPolicyBtnEl(): HTMLAnchorElement | null {
    return document.getElementById('viewPrivacyPolicyBtn') as HTMLAnchorElement;
}
function getConsentCheckboxEl(): HTMLInputElement | null {
    return document.getElementById('consentCheckbox') as HTMLInputElement;
}
function getContentStorageCheckboxEl(): HTMLInputElement | null {
    return document.getElementById('contentStorageConsentCheckbox') as HTMLInputElement;
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

function releaseConsentTrap(): void {
    if (consentTrapId) {
        focusTrapManager.release(consentTrapId);
        consentTrapId = null;
    }
}

/**
 * プライバシーポリシー同意初期化
 */
export async function initPrivacyConsent(): Promise<void> {
    try {
        // モーダル表示判定（レガシーマイグレーション・拒否カウンタの30日猶予規則は
        // privacyConsent.ts 内部 — PBI 2026-09-15-08 で locality を回復）
        if (await shouldPromptForConsent()) {
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
    const contentCb = getContentStorageCheckboxEl();
    const acceptBtn = getAcceptConsentBtnEl();
    const policyBtn = getViewPolicyBtnEl();
    const title = getPrivacyConsentTitleEl();

    // 状態リセット
    if (cb) cb.checked = false;
    if (contentCb) contentCb.checked = false;
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

    // モーダル表示（ESCで閉じない: 'cancel'イベントをpreventDefaultする）
    modal.showModal();

    // フォーカストラップ設定（ESCでは閉じないため closeCallback は渡さない）。
    // 再表示時の二重 trap を避けるため既存トラップを先に解放する。
    releaseConsentTrap();
    consentTrapId = focusTrapManager.trap(modal);

    // チェックボックスにフォーカス
    cb?.focus();
}

/**
 * 同意モーダルを非表示にする
 */
function hidePrivacyConsentModal(): void {
    const modal = getModalEl();
    if (!modal) return;

    releaseConsentTrap();
    modal.close();

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
        // 同意レコード（署名付き）+ 本文保存フラグ + ack の3点セットと状態変更
        // 通知は privacyConsent.ts（深い module）が所有 — PBI 2026-09-15-08。
        const contentCb = getContentStorageCheckboxEl();
        await acceptConsent({ contentStorageEnabled: contentCb?.checked ?? false });
        hidePrivacyConsentModal();
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
    const newCount = await declineConsent();

    hidePrivacyConsentModal();

    if (newCount >= 3) {
        return;
    }

    const message = getMessage('consentDeclinedMessage') ||
        'Without consent, main features of the extension will not be available. You can consent later from the settings screen.';
    alert(message);
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

    // ESCキーで閉じない（同意の明示的なアクションを要求）
    if (modal) {
        modal.addEventListener('cancel', (e: Event) => {
            e.preventDefault();
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
