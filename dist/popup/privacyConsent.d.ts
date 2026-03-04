/**
 * privacyConsent.ts
 * プライバシーポリシー同意管理 (GDPR/CCPA対応)
 */
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
export declare function getPrivacyConsent(): Promise<PrivacyConsentState>;
/**
 * プライバシーポリシー同意状態を保存
 * @param version 同意したポリシーバージョン（デフォルト: 2026-02-23）
 */
export declare function savePrivacyConsent(version?: string): Promise<void>;
/**
 * ユーザーがプライバシーポリシーに同意しているか確認
 */
export declare function hasPrivacyConsent(): Promise<boolean>;
/**
 * 同意が必要な機能のガード関数
 * 同意していない場合、エラーをスロー
 */
export declare function requireConsent(): Promise<void>;
/**
 * 既存ユーザーのマイグレーション
 * 既にプライバシー機能を使用していたユーザーを同意済みとして扱う
 */
export declare function migrateLegacyPrivacyConsent(): Promise<boolean>;
//# sourceMappingURL=privacyConsent.d.ts.map