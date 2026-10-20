# PBI 01: ログ引数 Swap の修正（38 箇所/9 ファイル）

## ユーザーストーリー
メンテナーとして、logWarn/logError/logInfo の引数順が一貫した状態がほしい、なぜなら message フィールドにモジュール名が入り続けると診断 UI の検索・ErrorCode 集計が両方向で壊れ、マスキング経路との不整合が観測できないから。

## 変更点の概要
第1引数（message）にモジュール名、第4引数（source）に人間向け説明を入れている 38 箇所を、canonical 形（message=説明、source=モジュール名）へ機械的に入れ替える。ログ API のシグネチャは変更しない。

## 現状と問題
- src/utils/permissionManager.ts:128,144,157,184,203,233,273,324,342,359,372（11 箇所）
- src/utils/trustDb/TrustDbKernel.ts（×7）/ trancoUpdater.ts（×7）/ trustDbVersion.ts（×3）/ trancoChangeDetector.ts ×1 / TrustPolicy.ts ×1
- src/utils/trustChecker.ts:93
- src/dashboard/settings/trustSettings.ts（×5）/ aiProviderB 側（×2）
- canonical 形の前例: src/utils/privacyConsent.ts:357-362、src/background/pipeline/steps/headerDetector.ts:51

## 変更の理由
[可読性/DRY] 38 箇所が canonical と逆順で、ログバッファの message が "PermissionManager"/"TrustDb" になる。説明は source 側へ逃げており、診断パネルの検索・集計が壊れる。入れ替えは機械的で挙動（出力情報の総量）は同一。

## 提案コード（骨子）
現行: logWarn('PermissionManager', { ...details }, ErrorCode.X, '権限チェックに失敗')
統一後: logWarn('権限チェックに失敗', { ...details }, ErrorCode.X, 'PermissionManager')

## BDD受け入れシナリオ
Scenario: 引数入れ替え後も同じ情報がログに残る
  Given 権限チェックが失敗する設定
  When isHostPermitted が失敗する
  Then ログの message に説明文、source にモジュール名が入る（message + source の結合内容は変更前と同一）

Scenario: 診断パネルの source 検索
  Given 38 箇所の入れ替えが完了している
  When 診断パネルでモジュール名を source で検索する
  Then 38 箇所すべてが source 検索でヒットし、message 検索ではヒットしない

## 見積もり
2 pt（RICE: 76 = Reach 38 × Impact 2 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [ ] 38 箇所すべてで引数順が canonical と一致する
- [ ] message/source 形を pin するテストを 1 本追加し通過
- [ ] npm run validate 通過（既存テスト全通過）
