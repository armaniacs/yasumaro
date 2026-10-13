# PBI: connectionTests の status 書き込みを showStatus 契約に統一する（F19 消費）

- 種別: refactor
- RICE: 2.0（R4 × I0.5 × C1.0 / E1.0）
- 依存: NN05（messages.json のキーを参照するのみ — NN05 着地後に実装）
- バッチ: W4
- 台帳送り消費: F19（connectionTests の syncStatusToTop 冗長呼び出し — 次に connection tests を触る時トリガー発火）

## ユーザーストーリー

保守担当者として、status 書き込み契約（className 全量書き込み、#statusTop ミラー）が showStatus seam の 1 箇所にあってほしい。なぜならエラー分岐ごとに 3 行の status ブロックが複製され、ミラー契約が seam とこのファイルの 2 箇所に存在するから。

## 背景（現状）

- `src/dashboard/generalSettings/connectionTests.ts:302-303,350-360,421-431,448-471,490-515` — `textContent + className='error' + syncStatusToTop()` の status 書き込みブロックが 5 重複、`syncStatusToTop()` 冗長呼び出し 15 箇所
- `src/utils/ui/settingsUiHelper.ts:93-95` — seam 側が「`showStatus('status', …)` は自動ミラー。手呼び `syncStatusToTop` は冪等な残骸」と宣言済みの移行先回り
- `:302-303,448-450` — `clearElement + className='' + textContent` の onStart 前置き
- `showSaveError`（:49）は既に `showStatus` 経由 — 形は社内で実証済み

## BDD 受け入れシナリオ

```gherkin
Scenario: 接続テストのエラー表示が showStatus 経由になる
  Given Obsidian 接続テストが失敗する
  When エラー分岐が走る
  Then showStatus('status', getMessageOr('testError', ...), 'error') が表示とミラーを所有する

Scenario: 冗長な手呼びミラーが残らない
  Given showStatus の自動ミラーが有効である
  When connectionTests.ts を検査する
  Then 手呼び syncStatusToTop() は 0 件である
```

## 受け入れ基準

- [x] 5 箇所の status 書き込みブロックを `showStatus('status', getMessageOr(key, fallback), ...)` に置換する
- [x] 手呼び `syncStatusToTop()` 15 箇所を削除する（seam が自動ミラー）
- [x] onStart 前置きの `clearElement + className=''` を seam 契約に置換する
- [x] 既存テストが green（表示内容は不変）
- [x] className 手書きが本ファイルから消える

## テスト戦略

- unit: `src/dashboard/generalSettings/__tests__/connectionTests*.test.ts` — status アサーションが showStatus 契約に追従（既存の期待値は表示内容が不変のため変更なし設計）
- 挙動不変: 表示される文言・タイミングは不変（書き込み経路の統合のみ）

## 見積もり

1.0 SP

## 技術的考慮事項

- showStatus の自動ミラー契約を確認（settingsUiHelper.ts:93-95）してから手呼びミラーを削除
- NN05 依存: messages.json キーは NN05 が追加済み（W2 着地後）
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. showStatus の自動ミラー契約を確認
2. 5 箇所の status ブロックを showStatus 置換、syncStatusToTop 削除
3. `npx vitest run src/dashboard/generalSettings` で検証

### 落とし穴

- syncStatusToTop 削除後、#statusTop ミラーが更新されないケースがないか既存テストで確認（seam が自動ミラーする設計のため削除可と裏取り済み）
- clearElement 前置きは seam 側の書き込み契約で置換（className='' 手書きを消す）

## Definition of Done

- [x] status 書き込みが showStatus 契約に統一
- [x] 手呼び syncStatusToTop 消滅（F19 消費）
- [x] `npx vitest run src/dashboard` が green
- [x] ロールバック不要（書き込み経路の統合）
