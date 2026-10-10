# PBI: dashboard の i18n リテラル群を getMessageOr 契約に統一する（F14/F17 消費）

- 種別: fix
- RICE: 5.3（R8 × I2 × C1.0 / E3.0）
- 依存: なし（messages.json の編集を独占する）
- バッチ: W2
- 台帳送り消費: F14（cleansingStatsView i18n — i18n カバレッジ改善時トリガー発火）、F17（exportLogsPanel limit: 100000 — export logs panel 触るトリガー発火）

## ユーザーストーリー

英語ロケールのユーザーとして、dashboard の status 文言がロケールに従っていてほしい。なぜなら複数パネルで日本語リテラルが直書きされ、en ロケールでも日本語が混在して見えるから。

## 背景（現状）

AGENTS.md の i18n 約束（user-facing text は data-i18n / t()）からの逸脱。動的生成 status は data-i18n 静的網羅で捉えられず、`getMessageOr` seam が実在するのに迂回されている:

- `src/dashboard/panels/diagnostic/exportLogsPanel.ts:26-110` — 全面ハードコード（英語 `'Exporting JSON…'` `'JSON export completed.'` `'Export failed: ${message}'` `'Binary export requires OPFS storage. Use JSON export instead.'`、日本語 `'取得中...'` `'データがありません'` `監査ログは ${rows.length} / ${total} 件のみ取得できました…` `${rows.length} 件をダウンロードしました` `エラー: ${...}`）。同 `:queryAuditLogs({ limit: 100000 })` — F17、`AUDIT_CAP_IDB`（src/utils/limits.ts）が SSOT
- `src/dashboard/cleansingFeedbackView.ts:84,87,100,139` — 同一関数内で getMessageOr（ヘッダ）と直書き（`'全削除'` `'報告はありません'` `'削除'`、タイトル `Cleansing Feedback (${entries.length})`）が混在
- `src/dashboard/cleansingStatsView.ts:327,350,379` — `原文 ${originalLen}字 → …` `除去内容プレビュー: ${diffText}` `削減率 ${reduction.toFixed(1)}%`（F14）
- `src/dashboard/settings/customPromptManager.ts:383,431,470,588,601` — エラー系のみ直書き（`'Invalid prompt'` `'Cannot edit default prompt…'` `'Cannot delete default prompt'` `'Preset not found'`）、success 系は翻訳済み → en/ja 混在
- `src/dashboard/encryptedBackupPanel.ts:55,57,74,84,95` — `'暗号化バックアップを作成しました'` 等の日本語リテラル 5 箇所
- `src/dashboard/gistSettings.ts:83` — `'Gist settings saved'`
- `src/dashboard/trancoConsent.ts:114` — `|| \`再確認まで ${n} 日\``（{days} 置換手書き）
- `src/dashboard/localMarkdownExport.ts:74,77` — `${result.totalRows}件の記録を…` `エクスポートに失敗しました: ${errorMessage(e)}`

## BDD 受け入れシナリオ

```gherkin
Scenario: en ロケールでも dashboard 文言が英語で表示される
  Given メッセージキーが _locales/en/messages.json に追加されている
  When exportLogsPanel の JSON export を実行する
  Then status 文言は getMessageOr(key, fallback) 経由で英語が表示される

Scenario: 監査ログ取得上限が SSOT から来る
  Given exportLogsPanel の監査ログクエリ
  When limit を指定する
  Then 値は AUDIT_CAP_IDB 参照であり、100000 リテラルは残らない
```

## 受け入れ基準

- [x] 上記 9 ファイルの直書き文言を `getMessageOr('<key>', <fallback>)` に置換する（キーは各文言に新設）
- [x] `_locales/ja/messages.json` と `_locales/en/messages.json` に全新規キーを追加する（本 PBI が messages.json の編集を独占）
- [x] `exportLogsPanel` の `limit: 100000` を `AUDIT_CAP_IDB` 参照に置換する（F17 消費）
- [x] fallback 文字列は現行文言をそのまま保持（挙動不変・ja では見た目不変）
- [x] `rg` で上記ファイル群の生文言リテラル（getMessageOr 経由でない user-facing 文字列）が 0 件であることを確認
- [x] 既存テストが green（文言変更なし・キー追加のみ）

## テスト戦略

- unit: 対象パネルの既存テストが green（fallback 文字列は現行文言と同一のため、テストの期待値変更は不要な設計）
- i18n: キー追加の整合は `_locales` の構造に従う（ja/en 両方に同一キーセット）
- 挙動不変: ja ロケールでの見た目は不変、en ロケールで翻訳が表示されるようになる（意図的変更）

## 見積もり

3.0 SP

## 技術的考慮事項

- messages.json は本 PBI が独占する（W2 で編集、W3/W4 の PBI は参照のみ）
- `getMessageOr` のシグネチャ・既存キー命名規則（settingsSaveError 等）に従う
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. `_locales` の配置を確認（manifest の default_locale と public/_locales or _locales 配置）
2. 各ファイルの文言を `getMessageOr` に置換（キー命名: `<パネル名><用途>` 形式、既存キー規則に従う）
3. ja/en の messages.json にキー追加
4. exportLogsPanel の limit を `AUDIT_CAP_IDB` import に置換
5. `npx vitest run src/dashboard` で検証

### 落とし穴

- fallback 文字列に `${...}` 補間が含まれる場合（監査ログ上限文言など）は、`getMessageOr` の戻り値をテンプレート補間してから表示する（キーは素の文言、補間は呼び出し側）
- `trancoConsent` の `{days}` 置換は `getMessageWithSubstitutions`（src/utils/i18n）を確認して既存 adapter に寄せる
- cleansingFeedbackView / cleansingStatsView は document.createElement で構築されるため data-i18n 属性ではなく getMessageOr 経由が正

## Definition of Done

- [x] 9 ファイルの直書き文言が getMessageOr 契約に統一
- [x] ja/en messages.json に全キー追加
- [x] `limit: 100000` リテラルが消滅（F17 消費）
- [x] cleansingStatsView の i18n 逸脱が解消（F14 消費）
- [x] `npx vitest run src/dashboard` が green
- [x] ロールバック不要（i18n 整合のみ・ja 見た目不変）
