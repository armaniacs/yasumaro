# PBI: i18n seam 迂回残存の置換（refactor）

優先度: 台帳 RICE 9.3（Reach 7 / Impact 2 / Confidence 1.0 / Effort 1.5pt）
backlog: [2026-09-18-00-backlog-holistic-0918c.md](2026-09-18-00-backlog-holistic-0918c.md)（台帳、候補 C1）
依存: なし

## ユーザーストーリー

拡張機能の UI を保守する開発者として、翻訳文言の取得を `getMessageOr` seam に完全に寄せてほしい、なぜなら seam のコメントが「raw idiom を seam の後ろに置く」ために存在すると明記する一方、`chrome.i18n.getMessage(key) || fallback` の素書きが約40サイト残っており、欠落キー時の挙動が実装箇所ごとに曖昧になっているから。

## 背景（現状と課題）

`src/utils/i18n.ts` の `getMessageOr(key, fallback, substitutions?)` は `getMessage(key) || fallback` idiom の SSOT である（i18n.ts 60行目付近のコメントに設計意図を明記）。だが同一 idiom が残存する（着手時に行番号を再確認すること）:

- `src/dashboard/panels/staticForm/privacySettingsPanel.ts`（約16サイト — consented / confirmWithdraw 系 / clearAll 系）
- `src/content/privacyDialog.ts`（title/body/saveLabel/cancelLabel/statusLabel）
- `src/background/notificationHelper.ts`（obsidianSyncFailed / notifyPrivacyConfirm 系）
- `src/background/pipeline/resultBuilder.ts`（recordingFailed / saveToObsidian）
- `src/dashboard/reviewSummaryHandler.ts`（testingConnection / reviewSummaryFailed ほか）
- `src/dashboard/exportImport.ts`（importPreviewSummary / importPreviewNote）
- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts`（settingsSaved / settingsSaveError）
- `src/content/visitReporter.ts`（連鎖 fallback: getMessage(k1) || getMessage(k2) || literal）
- `src/background/handlers/contextMenuHandlers.ts`（contextMenuRecord）
- `src/background/handlers/recordingHandlers.ts`（resolver コールバック経由 — 要確認）

対象外: fallback 無しの素 `chrome.i18n.getMessage(key)` 呼び出し（privatePageDialog・pendingPages の一部）、`popup/errorUtils.ts` の `getMsgWithCache`（キャッシュ機構が目的）、`utils/i18n.ts`・`i18nPlural.ts`・`localeUtils.ts` 自身。

置換ルール（byte-identical）:
- `getMessage(key) || fb` → `getMessageOr(key, fb)`
- `getMessage(key, [subs]) || fb` → `getMessageOr(key, fb, [subs])`
- `getMessage(k1) || getMessage(k2) || fb` → `getMessageOr(k1, getMessageOr(k2, fb))`

## BDD受け入れシナリオ

```gherkin
Scenario: 翻訳ありキーは従来どおり翻訳文を返す
  Given _locales に翻訳が存在するキー
  When 置換後の各呼び出し経路を実行する
  Then 返る文字列は置換前と同一である

Scenario: 欠落キーは従来どおり fallback を返す
  Given _locales に存在しないキー
  When 置換後の各呼び出し経路を実行する
  Then fallback 文字列が返る（getMessageOr は message || fallback で同一）
```

## 受け入れ基準

- [x] `|| fallback` 形の迂回が対象ファイルから除去されている
- [x] 各ファイルに `getMessageOr` の import が追加されている
- [x] fallback 無しの素呼び出し・getMsgWithCache には手を付けていない
- [x] `npm run type-check` が green
- [x] 変更ファイルの関連 vitest が green
- [x] `grep -rn "getMessage(.*) ||" src --include="*.ts" | grep -v __tests__` が対象外のみを返す

## テスト戦略

- 挙動は同一実装（message || fallback）への委譲のため既存テストで担保。変更ファイルの関連テストを実行
- 置換漏れ・過剰置換は grep で機械確認

## 見積もり

1.5pt（約40サイト・10ファイルの機械置換。privacySettingsPanel の多 site 分が大半）。

## 実装ガイド

- 着手時点での確認ポイント: 各サイトの正確な idiom 形（単純/配列subs/連鎖）。`recordingHandlers.ts` の resolver コールバックは `resolveReasonLabel` の契約を確認してから判断する（変更不要の可能性）
- 文言・fallback 文字列・置換配列の内容に手を入れないこと
- git 操作・pbi 編集は統合側が行う
