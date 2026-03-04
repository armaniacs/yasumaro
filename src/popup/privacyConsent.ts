/**
 * privacyConsent.ts
 * プライバシーポリシー同意管理 (GDPR/CCPA対応)
 */

import { StorageKeys } from '../utils/storage.js';
import { logInfo, logWarn, logError, ErrorCode } from '../utils/logger.js';

/** プライバシーポリシー同意状態 */
export interface PrivacyConsentState {
    /** ユーザーが同意しているかどうか */
    hasConsented: boolean;
    /** 同意日時 (ISO 8601形式) */
    consentDate?: string;
    /** 同意したポリシーバージョン */
    consentVersion?: string;
}

/**
 * プライバシーポリシー同意状態を取得
 */
export async function getPrivacyConsent(): Promise<PrivacyConsentState> {
    try {
        const result = await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT);
        const consentValue = result[StorageKeys.PRIVACY_CONSENT];

        // レガシー形式（ブール値）の処理
        if (typeof consentValue === 'boolean') {
            return {
                hasConsented: consentValue
            };
        }

        // 現代形式（オブジェクト）の処理
        if (typeof consentValue === 'object' && consentValue !== null) {
            const data = consentValue as PrivacyConsentState;
            return {
                hasConsented: data.hasConsented === true,
                consentDate: data.consentDate,
                consentVersion: data.consentVersion
            };
        }

        // 未設定の場合
        return { hasConsented: false };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await logError(
            'Failed to get privacy consent state',
            { error: errorMessage },
            ErrorCode.STORAGE_READ_FAILURE,
            'privacyConsent.ts'
        );
        return { hasConsented: false };
    }
}

/**
 * プライバシーポリシー同意状態を保存
 * @param version 同意したポリシーバージョン（デフォルト: 2026-02-23）
 */
export async function savePrivacyConsent(version: string = '2026-02-23'): Promise<void> {
    try {
        const data: PrivacyConsentState = {
            hasConsented: true,
            consentDate: new Date().toISOString(),
            consentVersion: version
        };

        await chrome.storage.local.set({ [StorageKeys.PRIVACY_CONSENT]: data });
        await logInfo(
            'Privacy consent saved',
            { version, date: data.consentDate },
            'privacyConsent.ts'
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await logError(
            'Failed to save privacy consent',
            { error: errorMessage },
            ErrorCode.STORAGE_WRITE_FAILURE,
            'privacyConsent.ts'
        );
        throw error;
    }
}

/**
 * ユーザーがプライバシーポリシーに同意しているか確認
 */
export async function hasPrivacyConsent(): Promise<boolean> {
    const state = await getPrivacyConsent();
    return state.hasConsented;
}

/**
 * 同意が必要な機能のガード関数
 * 同意していない場合、エラーをスロー
 */
export async function requireConsent(): Promise<void> {
    const hasConsent = await hasPrivacyConsent();
    if (!hasConsent) {
        throw new Error('Privacy consent required. Please accept the privacy policy to use this feature.');
    }
}

/**
 * 既存ユーザーのマイグレーション
 * 既にプライバシー機能を使用していたユーザーを同意済みとして扱う
 */
export async function migrateLegacyPrivacyConsent(): Promise<boolean> {
    try {
        // 既に同意がある場合はマイグレーション不要
        const existing = await getPrivacyConsent();
        if (existing.hasConsented) {
            return false;
        }

        // 既存のプライバシー機能使用状況をチェック
        const result = await chrome.storage.local.get([
            StorageKeys.PRIVACY_MODE,
            StorageKeys.PII_CONFIRMATION_UI,
            StorageKeys.MASTER_PASSWORD_ENABLED
        ]);

        const hasUsedPrivacyFeatures =
            result[StorageKeys.PRIVACY_MODE] !== undefined ||
            result[StorageKeys.PII_CONFIRMATION_UI] !== undefined ||
            result[StorageKeys.MASTER_PASSWORD_ENABLED] === true;

        if (hasUsedPrivacyFeatures) {
            await savePrivacyConsent();
            await logInfo(
                'Legacy user migrated to privacy consent',
                { migrated: true },
                'privacyConsent.ts'
            );
            return true;
        }

        return false;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await logWarn(
            'Failed to migrate legacy privacy consent',
            { error: errorMessage },
            undefined,
            'privacyConsent.ts'
        );
        return false;
    }
}