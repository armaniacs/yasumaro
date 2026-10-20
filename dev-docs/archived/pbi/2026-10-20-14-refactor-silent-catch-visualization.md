# PBI 14: 空 catch・握りつぶしの可視化（診断レベルの追加）

## ユーザーストーリー
メンテナーとして、握り潰された失敗がログに残る状態がほしい、なぜなら空 catch や catch { return false } はデータ消失・障害を diagnostics から不可視にし、観測可能性を失わせるから。

## 変更点の概要
空 catch・握りつぶしに logError 追加を行う。戻り値は変更しないため、成功/失敗の返却契約は不変（診断のみの追加）。

## 現状と問題
- src/utils/storage/privacyConsent.ts:459-476（getConsentDeniedCount / getLastConsentDenialTime が空 catch、0/null を返す）
- src/utils/storage/savedUrlRepository.ts:517-521（purgeLegacyStorage の空 catch）
- src/background/retryPendingWrites.ts:27-29, :44-46（catch { return false; } ×2、失敗ログなし）
- src/utils/crypto/hmacKeyStore.ts:336（.catch(() => undefined) ― encryptionSession.ts:947-953 は観測可能化済みで方針が不統一）
- src/content/contentExtractor/index.ts:263-266（catch が report 記録なしに握り潰し）

## 変更の理由
[エラーハンドリング] 障害観測。戻り値不変の診断追加は refactor 互換（2026-10-11 類例）。

## 提案コード（骨子）
catch (error: unknown) {
  void logError('purgeLegacyStorage に失敗', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILED, 'savedUrlRepository');
  return 0; // 変更なし
}

## BDD受け入れシナリオ
Scenario: 握りつぶしがログに残る
  Given ストレージ読み取りが失敗する
  When getConsentDeniedCount が catch 経路を通る
  Then 0 が返る（変更前と同一）と同時に logError が 1 件記録される

Scenario: pending 書き込みの再試行失敗が観測される
  Given 書き込みが 2 回失敗する
  When retryPendingWrites が catch { return false } を通る
  Then false が返る（変更前と同一）と同時に失敗ログが記録される

## 見積もり
1 pt（RICE: 20 = Reach 6 × Impact 2 × Confidence 1.0 ÷ Effort 0.6 人日）

## DoD
- [x] 対象 5 箇所で logError 追加済み（戻り値は不変）
- [x] 追加後の既存テスト全通過
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- catch ブロック計 7 箇所に logError を追加（PBI 記載の 5 箇所 + 発見した 2 箇所）: privacyConsent の getConsentDeniedCount / getLastConsentDenialTime の空 catch、savedUrlRepository purgeLegacyStorage の内側 catch、retryPendingWrites の legacy payload / metadata-patch の catch { return false }、hmacKeyStore の .catch(() => undefined)（safeLog seam 規約）、contentExtractor extractInternal の外側 catch（同期のため void logError）
- ErrorCode は既存コードのみ（STORAGE_READ_FAILURE / STORAGE_WRITE_FAILURE / CRYPTO_HMAC_FAILURE / CONTENT_EXTRACTION_FAILURE）。戻り値・制御フローはすべて不変
- 検証: 担当モジュール 5 グループ 1032 tests 全 green、eslint 5 ファイル 0 errors、validate:fast green
