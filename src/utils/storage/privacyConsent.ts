// @layer 1 — Infrastructure: privacy consent state (chrome.storage-backed, Layer 0 only)
/**
 * storage/privacyConsent.ts
 * プライバシーポリシー同意管理 (GDPR/CCPA対応)
 */

import { StorageKeys } from './types.js';
import { errorMessage } from '../errorUtils.js';
import { ErrorCode } from '../logger/types.js';
import { logInfo, logWarn, logError } from '../logger/api.js';
import { consentHmacSigner } from '../crypto/index.js';
import { pickDefined } from '../objectUtils.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';

/** プライバシーポリシーバージョン定数。PRIVACY.md の「最終更新日」と同期させること */
export const PRIVACY_POLICY_VERSION = '2026-07-31';

/** プライバシーポリシー同意状態 */
export interface PrivacyConsentState {
    /** ユーザーが同意しているかどうか */
    hasConsented: boolean;
    /** 同意日時 (ISO 8601形式) */
    consentDate?: string;
    /** 同意したポリシーバージョン */
    consentVersion?: string;
    /** ポリシーバージョンが変更され、再同意が必要かどうか */
    needsReconsent?: boolean;
}

/** ストレージに保存される同意状態（HMAC署名付き） */
interface SignedPrivacyConsentRecord {
    hasConsented: boolean;
    consentDate?: string;
    consentVersion?: string;
    withdrawal?: PrivacyConsentWithdrawal;
    /** HMAC署名（hasConsented/consentDate/consentVersion/withdrawalを対象） */
    signature?: string;
}

/**
 * 署名対象データを安定した文字列表現に変換する。
 * フィールド追加時の互換性のため、明示的にキーを列挙する。
 */
function buildSignaturePayload(record: Omit<SignedPrivacyConsentRecord, 'signature'>): string {
    return JSON.stringify({
        hasConsented: record.hasConsented,
        consentDate: record.consentDate ?? null,
        consentVersion: record.consentVersion ?? null,
        withdrawal: record.withdrawal ?? null
    });
}

/**
 * 同意状態レコードにHMAC署名を付与して保存する。
 */
async function signAndStoreConsent(record: Omit<SignedPrivacyConsentRecord, 'signature'>): Promise<void> {
    const payload = buildSignaturePayload(record);
    const signature = await consentHmacSigner.sign(payload);
    const signedRecord: SignedPrivacyConsentRecord = { ...record, signature };
    await chrome.storage.local.set({ [StorageKeys.PRIVACY_CONSENT]: signedRecord });
}

/**
 * プライバシーポリシー同意状態を取得
 */
export async function getPrivacyConsent(): Promise<PrivacyConsentState> {
    try {
        const result = await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT);
        const consentValue = result[StorageKeys.PRIVACY_CONSENT];

        // レガシー形式（ブール値）の処理
        // WHY: Legacy boolean has no version info; treat as needing re-consent to avoid stale consent after policy updates.
        // Migration (migrateLegacyPrivacyConsent) normally converts these to object format on startup,
        // so this branch is rare. If hit, force re-consent when the value is true.
        if (typeof consentValue === 'boolean') {
            return {
                hasConsented: false,
                needsReconsent: consentValue === true
            };
        }

        // 現代形式（オブジェクト）の処理
        if (typeof consentValue === 'object' && consentValue !== null) {
            const data = consentValue as SignedPrivacyConsentRecord;

            // 署名が付与されている場合は改ざんチェックを行う。
            // 署名がない場合（マイグレーション前の既存データ）は後方互換として読み込む。
            if (typeof data.signature === 'string') {
                const payload = buildSignaturePayload(data);
                const isValid = await consentHmacSigner.verify(payload, data.signature);
                if (!isValid) {
                    await logWarn(
                        'Privacy consent signature verification failed — treating as unconsented',
                        {},
                        undefined,
                        'privacyConsent.ts'
                    );
                    return { hasConsented: false };
                }
            }

            const versionMatch = data.consentVersion === PRIVACY_POLICY_VERSION;
            // バージョン不一致の場合、再同意が必要
            const needsReconsent = !versionMatch && data.hasConsented === true;
            return {
                hasConsented: data.hasConsented === true && versionMatch,
                needsReconsent,
                ...pickDefined({ consentDate: data.consentDate, consentVersion: data.consentVersion })
            };
        }

        // 未設定の場合
        return { hasConsented: false };
    } catch (error) {
        await logError(
            'Failed to get privacy consent state',
            { error: errorMessage(error) },
            ErrorCode.STORAGE_READ_FAILURE,
            'privacyConsent.ts'
        );
        return { hasConsented: false };
    }
}

/**
 * プライバシーポリシー同意状態を保存
 * @param version 同意したポリシーバージョン（デフォルト: PRIVACY_POLICY_VERSION）
 */
export async function savePrivacyConsent(version: string = PRIVACY_POLICY_VERSION): Promise<void> {
    try {
        const data: PrivacyConsentState = {
            hasConsented: true,
            consentDate: new Date().toISOString(),
            consentVersion: version
        };

        await signAndStoreConsent(data);
        await logInfo(
            'Privacy consent saved',
            { version, date: data.consentDate },
            'privacyConsent.ts'
        );
    } catch (error) {
        await logError(
            'Failed to save privacy consent',
            { error: errorMessage(error) },
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
        // 単一のストレージ呼び出しで同意状態とプライバシー機能使用状況を取得
        const result = await chrome.storage.local.get([
            StorageKeys.PRIVACY_CONSENT,
            StorageKeys.PRIVACY_MODE,
            StorageKeys.PII_CONFIRMATION_UI,
            StorageKeys.MASTER_PASSWORD_ENABLED
        ]);

        // 既に同意がある場合はマイグレーション不要
        const consentValue = result[StorageKeys.PRIVACY_CONSENT];
        const hasAlreadyConsented =
            typeof consentValue === 'boolean' ? consentValue :
            typeof consentValue === 'object' && consentValue !== null ? (consentValue as PrivacyConsentState).hasConsented === true :
            false;

        if (hasAlreadyConsented) {
            return false;
        }

        // 既存のプライバシー機能使用状況をチェック
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
        await logWarn(
            'Failed to migrate legacy privacy consent',
            { error: errorMessage(error) },
            undefined,
            'privacyConsent.ts'
        );
        return false;
    }
}

/** プライバシーポリシー同意撤回記録 */
export interface PrivacyConsentWithdrawal {
    withdrawalDate: string;
    previousConsentDate?: string;
    previousConsentVersion?: string;
}

/**
 * プライバシーポリシー同意を撤回する (GDPR Art.7)
 */
export async function withdrawPrivacyConsent(): Promise<PrivacyConsentWithdrawal> {
    try {
        const currentConsent = await getPrivacyConsent();
        const withdrawal: PrivacyConsentWithdrawal = {
            withdrawalDate: new Date().toISOString(),
            ...pickDefined({
                previousConsentDate: currentConsent.consentDate,
                previousConsentVersion: currentConsent.consentVersion
            })
        };

        const withdrawnState: PrivacyConsentState & { withdrawal?: PrivacyConsentWithdrawal } = {
            hasConsented: false,
            withdrawal
        };

        await signAndStoreConsent(withdrawnState);
        await logInfo('Privacy consent withdrawn', { withdrawalDate: withdrawal.withdrawalDate }, 'privacyConsent.ts');
        return withdrawal;
    } catch (error) {
        await logError('Failed to withdraw privacy consent', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'privacyConsent.ts');
        throw error;
    }
}

/**
 * 同意撤回履歴を取得 */
export async function getConsentWithdrawalHistory(): Promise<PrivacyConsentWithdrawal | null> {
    const result = await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT);
    const data = result[StorageKeys.PRIVACY_CONSENT];
    if (typeof data === 'object' && data !== null && 'withdrawal' in data) {
        return (data as Record<string, unknown>).withdrawal as PrivacyConsentWithdrawal;
    }
    return null;
}

/**
 * ポリシーバージョンの確認を記録する
 * 同意/拒否の両方で呼び出し、再同意プロンプトを防止する
 */
export async function recordPolicyVersionAcknowledgment(): Promise<void> {
    try {
        await chrome.storage.local.set({
            [StorageKeys.PRIVACY_CONSENT_VERSION]: PRIVACY_POLICY_VERSION
        });
    } catch (error) {
        await logWarn(
            'Failed to record policy version acknowledgment',
            { error: errorMessage(error) },
            undefined,
            'privacyConsent.ts'
        );
    }
}

// ============================================================================
// Consent state-change notification (PBI 2026-09-15-08) — dual-channel subscribe
// ============================================================================
// Chrome 仕様: chrome.runtime メッセージは送信者自身のコンテキストへは配送され
// ない（過去に onboarding が再表示されない退行を生んだ）。同一コンテキストの
// 購読者には same-document イベントで、他コンテキスト（SW バッジ更新など）
// には runtime メッセージで届く — どちらの経路もこの subscribe が隠蔽する。

/** 同意状態変更の same-document イベント名（controller から移動）。 */
export const CONSENT_STATE_CHANGED_EVENT = 'consent-state-changed';

export function subscribeConsentChanges(listener: () => void): () => void {
    const docListener = () => listener();
    let onMessageListener: ((message: unknown) => void) | null = null;
    if (typeof document !== 'undefined') {
        document.addEventListener(CONSENT_STATE_CHANGED_EVENT, docListener);
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        onMessageListener = (message: unknown) => {
            if ((message as { type?: string } | undefined)?.type === 'CONSENT_STATE_CHANGED') {
                listener();
            }
        };
        chrome.runtime.onMessage.addListener(onMessageListener);
    }
    return () => {
        if (typeof document !== 'undefined') {
            document.removeEventListener(CONSENT_STATE_CHANGED_EVENT, docListener);
        }
        if (onMessageListener) {
            chrome.runtime.onMessage.removeListener(onMessageListener);
        }
    };
}

function notifyConsentChanged(): void {
    try {
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent(CONSENT_STATE_CHANGED_EVENT));
        }
        chrome.runtime.sendMessage({ type: 'CONSENT_STATE_CHANGED', protocolVersion: CURRENT_PROTOCOL_VERSION });
    } catch (error) {
        logWarn(
            'Failed to notify consent state change',
            { error: errorMessage(error) },
            undefined,
            'privacyConsent.ts'
        );
    }
}

// ============================================================================
// 高レベル遷移（同意/拒否）— 原子性と通知を内部化（PBI 2026-09-15-08）
// ============================================================================

/** 同意受け入れのオプション（本文保存のオプトイン）。 */
export interface AcceptConsentOptions {
    /** コンテンツ保存のオプトイン（モーダルのチェックボックス値）。 */
    contentStorageEnabled: boolean;
}

/**
 * 同意を受け入れる: consent レコード（署名付き）+ 本文保存フラグ + ack を
 * 一貫して書き込み、状態変更を通知する。
 */
export async function acceptConsent(options: AcceptConsentOptions): Promise<void> {
    await chrome.storage.local.set({
        [StorageKeys.CONTENT_STORAGE_ENABLED]: options.contentStorageEnabled,
    });
    await savePrivacyConsent();
    await recordPolicyVersionAcknowledgment();
    notifyConsentChanged();
}

/**
 * 同意を拒否する: 拒否カウンタ更新 + ack + 通知。新しいカウントを返す。
 */
export async function declineConsent(): Promise<number> {
    const newCount = await incrementConsentDeniedCount();
    await recordPolicyVersionAcknowledgment();
    notifyConsentChanged();
    return newCount;
}

// ============================================================================
// 拒否カウンタ（privacyConsentController から移動 — locality 回復）
// ============================================================================

/** 直近の拒否回数を取得（未設定は 0）。 */
export async function getConsentDeniedCount(): Promise<number> {
    try {
        const result = await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT_DENIED_COUNT);
        return Number(result[StorageKeys.PRIVACY_CONSENT_DENIED_COUNT] ?? 0);
    } catch {
        return 0;
    }
}

/** 直近の拒否時刻を取得（未設定は null）。 */
export async function getLastConsentDenialTime(): Promise<number | null> {
    try {
        const result = await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME);
        return (result[StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME] as number) ?? null;
    } catch {
        return null;
    }
}

/** 拒否を記録（カウンタ + 時刻）。 */
export async function incrementConsentDeniedCount(): Promise<number> {
    const current = await getConsentDeniedCount();
    const next = current + 1;
    await chrome.storage.local.set({
        [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: next,
        [StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME]: Date.now(),
    });
    return next;
}

/**
 * 同意拒否カウンターをリセットする
 * ポリシーバージョン変更時に呼び出す
 */
export async function resetConsentDeniedCount(): Promise<void> {
    await chrome.storage.local.set({
        [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: 0,
        [StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME]: 0,
    });
}

/**
 * 同意モーダルを表示すべきか（拒否カウンタの30日猶予規則を含む判定）。
 * マイグレーションも内部で実行する。
 */
export async function shouldPromptForConsent(): Promise<boolean> {
    await migrateLegacyPrivacyConsent();

    const state = await getPrivacyConsent();

    // ポリシーバージョンが変更された場合、拒否カウンターをリセットして再同意を促す
    if (state.needsReconsent) {
        await resetConsentDeniedCount();
        return true;
    }

    if (!state.hasConsented) {
        const denialCount = await getConsentDeniedCount();
        // After 3+ rejections, wait 30 days before showing the modal again
        if (denialCount >= 3) {
            const lastDenialTime = await getLastConsentDenialTime();
            const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
            if (lastDenialTime && (Date.now() - lastDenialTime < THIRTY_DAYS_MS)) {
                return false;
            }
        }
        return true;
    }

    return false;
}

/**
 * 同意を受け入れた際にオプトインされたコンテンツ保存フラグを読む
 * （controller の checkbox から移動した書き込み先の整合確認用）。
 */
export async function getContentStorageEnabled(): Promise<boolean> {
    try {
        const result = await chrome.storage.local.get(StorageKeys.CONTENT_STORAGE_ENABLED);
        return result[StorageKeys.CONTENT_STORAGE_ENABLED] === true;
    } catch {
        return false;
    }
}

/**
 * ポリシーバージョンが変更されたかチェックする
 */
export async function isPolicyVersionChanged(): Promise<boolean> {
    try {
        const result = await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT_VERSION);
        const stored = result[StorageKeys.PRIVACY_CONSENT_VERSION] as string | undefined;
        return stored !== PRIVACY_POLICY_VERSION;
    } catch {
        return true; // エラー時は再同意を促す
    }
}