# PBI: dashboard の英語ハードコード文字列を i18n 化

## ユーザーストーリー
日本語環境の利用者として、dashboard の表示文言も日本語で統一してほしい、なぜなら設定画面の一部だけ英語のままだと状態の読み取りを誤りやすく操作に迷うから

## 優先度
- 順位: 19 / 26
- RICEスコア: 500（Reach=500 / Impact=0.5 / Confidence=1.0 / Effort=0.5日）
- 根拠: 日本語話者全員に影響するが機能阻害ではないため Impact は小。対象文字列は確定済みで Confidence は最大、半日で対応可能。

## BDD受け入れシナリオ
```gherkin
Scenario: 日本語ロケールでは対象文字列が日本語で表示される
  Given ブラウザロケールが日本語の状態
  When  dashboard の該当画面（サイト別設定・接続テスト・プライバシー表示）を開く
  Then  対象文字列が日本語メッセージとして表示される

Scenario: 英語ロケールでは従来の英語表示が維持される
  Given ブラウザロケールが英語の状態
  When  dashboard の該当画面を開く
  Then  対象文字列が英語メッセージとして表示される
```

## 受け入れ基準
- [x] 下記4箇所の直書き英語が `getMessage` / `chrome.i18n.getMessage` 経由になる
- [x] `_locales/ja/messages.json` と `_locales/en/messages.json` の双方に新規キーが追加されている
- [x] `npm run type-check` と dashboard 関連の既存テストがパスする

## テスト戦略
- 単体: ロケールを切り替えた状態で各表示関数を呼び出し、対応するメッセージキーが参照されることを検証する
- 目視: 日英両ロケールで dashboard を開き、対象4箇所の表示を確認する

## 実装アプローチ
各箇所の直書きリテラルを `getMessage('新規キー') || '英語フォールバック'` 形式（dashboard の `connectionTests.ts` 既存パターン）に置き換え、日英メッセージ定義を追加する。スコープは dashboard のみとし、popup 側の文言は対象外とする。

## 見積もり
2ポイント（0.5日相当：4箇所の置き換えとメッセージ定義追加が中心）

## 実装者向け注記
- 確認済み現状（dashboard のみ）: `src/dashboard/settings/perSiteOverrides.ts:78`（`'No per-site overrides.'`）、`src/dashboard/panels/staticForm/privacySettingsPanel.ts:53`（`'Not consented'`、なお `:24` は `getMessage('notConsented')` 済みで表示側のみ未対応）、`src/dashboard/generalSettings/connectionTests.ts:255`（`header.textContent = 'AI: '`）、`src/dashboard/models-dev-dialog.ts:428`（`link.textContent = 'API Key →'`）
- 置き換え前例: `src/dashboard/generalSettings/connectionTests.ts:57,105,114` の `getMessage('connectionSuccess') || '...'` 形式に寄せる
- 注意: `src/dashboard/__tests__/` 配下の `textContent = '...'` はテスト用フィクスチャであり本PBIの対象外
- 調査用コマンド: `rg -n "textContent\s*=\s*'[^']*[A-Za-z]" src/dashboard --glob '!**/__tests__/**'`

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（i18n ガイドへの新規キー追記があれば）

## 実装メモ（2026-09-05・branch 0905c）
- 完了（commit `0327b37f`、SDD サブエージェント実装）。4 箇所（perSiteOverrides/privacySettingsPanel/connectionTests/models-dev-dialog）を i18n キー経由に変更（en/ja 追加・check-i18n PASS・テスト更新）。残存の直書き英語（保存系ステータス等）は別 PBI 候補としてレポートに記録。
