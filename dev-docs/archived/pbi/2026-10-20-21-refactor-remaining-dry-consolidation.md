# PBI 21: 残りの DRY 集約（生成系・シーム統合・ツール層）

## ユーザーストーリー
メンテナーとして、残りの同形複製と SSOT 迂回が集約された状態がほしい、なぜなら散在する同形コードは片側修正の温床で、SSOT を迂回した実装は統合 Wave の前提を崩すから。

## 変更点の概要
同形複製・SSOT 迂回・ツール層の重複を 1 実装へ集約する。出力は不変。

## 現状と問題
- ID 生成: src/utils/markdownTemplateUtils.ts:123（generateTemplateId が Date.now()+Math.random()）と src/utils/ui/focusTrap.ts:243（FocusTrapManager.generateId）が src/utils/generateId.ts（PBI 2026-10-03-24 の SSOT、128bit hex）に従わない
- promptSafety 統合 6 点目: src/utils/customPromptUtils.ts:231-244（validatePrompt が promptSafety seam 未経由、verdict → valid 変換）
- ドメイン抽出: src/utils/cspValidator.ts の extractDomainFromProvider が getProviderDomain と同一実装（委譲）
- 正規表現エスケープ: src/utils/wildcardToRegex.ts:34 と src/utils/string.ts:9（escapeRegex 二重定義、委譲）
- ドメインリストパース: src/utils/domainUtils.ts の parseDomainList と DomainFilter.parse（1 実装へ。未使用側は PBI 07 と関連）
- データ構造: src/content/contentKernel.ts:285-292 と :411-418（OWTestState リテラル重複）、src/content/contentExtractor/index.ts:211-231 と :235-254（14 フィールド引数オブジェクト複製）
- i18n 変換: src/popup/statusPanel.ts:200 と src/popup/statusRenderers.ts:55（mode → i18n キー変換の 2 方式）
- PII ラベル: src/popup/previewPresenter.ts:22-28（PII_TYPE_LABELS が messaging/types.ts:92 の validTypes と並行、raw key フォールバックで現行挙動を維持）
- リトライ: src/dashboard/utils/retry.ts の backoffDelayMs inline（utils/backoff.ts へ委譲）
- ツール層: eslint/rules の AST 走査 4 重複（no-vacuous-negative-wait.mjs:72-81 / no-test-sleep.mjs:61-76 / require-response-size-limit.mjs:75-87,121-133）
- 設定: src/utils/storage/settingsMigration.ts の MigrateSettingsOptions 並行定義（PBI 12 と関連）

## 変更の理由
[DRY] いずれも同形複製または SSOT 迂回で、1 実装への集約が可能。

## BDD受け入れシナリオ
Scenario: ID 生成の SSOT 準拠
  Given generateId.ts の SSOT
  When generateTemplateId と FocusTrapManager.generateId を通す
  Then 生成される ID 形式は SSOT と同一になり、一意性は変更前と同一である

Scenario: escapeRegex の委譲
  Given 特殊文字を含む入力
  When wildcardToRegex が string.ts の escapeRegex を通す
  Then 生成される正則は変更前と同一である

## 見積もり
2 pt（RICE: 13 = Reach 10 × Impact 2 × Confidence 1.0 ÷ Effort 1.5 人日）

## DoD
- [x] 表の全複製が 1 実装経由になる
- [x] 既存テスト全通過
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- 9 組統合: ID 生成 SSOT 準拠（generateTemplateId / FocusTrapManager.generateId / feedbackQueue のローカル generateId → src/utils/generateId.ts SSOT。プレフィックス保持、テストの ID 形式 pin 1 行更新）、promptSafety 6 点目（customPromptUtils.validatePrompt → checkPromptSafety(prompt, 'custom-input')。verdict・ログはバイト同一）、escapeRegex → string.ts escapeRegExp 委譲、cspValidator の extractDomainFromProvider 削除（getProviderDomain に一本化）、OWTestState 統合（e2eProbeRelay.buildProbeState）、retry の exponential 部を backoffDelayMs に委譲（parity pin 追加）、i18n キー変換統合（statusRenderers.i18nKeyFromValue）、eslint ツール層の AST 走査 4 重複を ast-walk.mjs に統合、settingsMigration の clock seam 二重定義を resolveNow に統合
- 統合済みだった組（触らず報告）: DomainFilter.parse（PBI 07 で統合済み）、contentExtractor 14 フィールド重複（PBI 24 で解消済み）、previewPresenter PII_TYPE_LABELS（統合先 validTypes が現行に存在せず piiSanitizer はプライバシー保証領域のため不触）
- 検証: フルスイート 1112 ファイル / 16560 テスト全 green、type-check 通過、eslint（19 ファイル）通過、validate:fast green
