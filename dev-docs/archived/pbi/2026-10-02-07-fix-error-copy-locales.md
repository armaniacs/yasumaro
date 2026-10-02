# PBI: purge エラーコピーの locales 欠落を修正する

種別: fix (C8, RICE #4)

## ユーザーストーリー

日本語 / 英語いずれの表示言語でもエラーメッセージが正しく表示されることを期待するユーザーとして、purge 失敗時のコピーが両言語の locales に揃っていてほしい。ハードコードされた英語表示のままでは日本語 UI の一貫性が崩れるから。

## 背景

purge ハンドラ経路のエラーコピー (`purgeNowFailed` / `contentPurgeNowFailed`) が `public/_locales` に未登録であり、フォールバックまたはハードコード表示に依存している。加えて `src/popup/statusPanel.ts:346,369` にハードコードされた `Invalid URL` 表示が残存し、i18n 経由になっていない。

## スコープ (file:line)

- purge handlers (purge 失敗コピーを表示するハンドラ群 — `purgeNowFailed` / `contentPurgeNowFailed` を参照・表示する箇所)
- `src/popup/statusPanel.ts:346`
- `src/popup/statusPanel.ts:369`
- `public/_locales/ja/messages.json`
- `public/_locales/en/messages.json`

## BDD 受け入れシナリオ

```gherkin
Scenario: purge 失敗コピーが両言語で表示される
  Given 表示言語が日本語または英語である
  When purge 処理が失敗する
  Then purgeNowFailed / contentPurgeNowFailed に対応するメッセージが選択言語で表示される

Scenario: Invalid URL 表示が i18n 経由になる
  Given statusPanel で不正 URL が扱われる
  When 該当パス (statusPanel.ts:346,369) が実行される
  Then ハードコード英語ではなく i18n キー経由のメッセージが表示される
```

## 受け入れ基準 (file-scoped)

- [x] `purgeNowFailed` キーが `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の両方に追加されている (またはフォールバック仕様がコードとして明文化されている)
- [x] `contentPurgeNowFailed` キーが `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の両方に追加されている (またはフォールバック仕様がコードとして明文化されている)
- [x] `src/popup/statusPanel.ts:346` のハードコード `Invalid URL` が i18n キー参照に置換されている
- [x] `src/popup/statusPanel.ts:369` のハードコード `Invalid URL` が i18n キー参照に置換されている
- [x] 日本語と英語の両言語で表示が目視またはテストにより確認されている

## テスト戦略

- 単体: 両 locale ファイルに新キーが存在することの静的 pin テスト、またはフォールバック解決のテスト
- 単体: statusPanel の該当パスで i18n キーが解決されることのテスト (両言語)
- 既存 locales テスト green 維持

## 振る舞い変更ルール (fix)

- ユーザー可視の文言変更は本 PBI の 3 キー (purge 系 2 + Invalid URL 1) に限定する
- 新規キーの既定文言は既存英語コピーと意味同一にする (意訳・新文言の追加は別 PBI)
- フォールバック仕様を変更する場合はコード + テストで明文化し、沈黙の握りつぶしにしない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [x] コードレビュー完了

## 実装記録 (2026-10-02)

- `public/_locales/ja/messages.json` / `en/messages.json` に 3 キーずつ追加: `purgeNowFailed` / `contentPurgeNowFailed` / `statusInvalidUrl` (既存英語コピーと意味同一、日本語は「削除に失敗しました」「content の削除に失敗しました」「無効なURLです」)
- `src/dashboard/generalSettings/settingsForm.ts`: `handlePurgeNow` / `handleContentPurgeNow` の `onError` を `getMessageOr('<key>', fallback)` + 技術理由サフィックス (`: detail`) に統一。フォールバック仕様はコードで明文化 (理由付きで沈黙の握りつぶしなし)
- `src/popup/statusPanel.ts`: 2 箇所のハードコード `'Invalid URL'` を `getMessageOr('statusInvalidUrl', 'Invalid URL')` に置換
- テスト: 新規 2 ファイル (`settingsForm-purgeFailedLocales.test.ts` 日英コピー表示、`statusInvalidUrlLocales.test.ts` 日英解決)、更新 2 スイート (`settingsForm.coverage.test.ts` 期待値を `prefix: detail` 形へ、`generalSettingsPanel-purge.test.ts` 2 assertions)
- 注: `check-i18n` という npm スクリプトは存在しないため locale pin テスト + validate で代替確認。`npm run validate` フル PASS (15423 passed)
