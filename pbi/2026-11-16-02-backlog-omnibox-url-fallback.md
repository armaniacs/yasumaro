# PBI: omnibox経路で tab.url が読めない場合の明示的フォールバック

- 状態: 未着手
- 種別: 非機能追加 (UX の沈黙失敗の解消)
- 見積もり: 1 SP
- 起票日: 2026-11-16
- 親 PBI: なし (chrome-extensions 監査 1116b ラウンドの積み残し)

## 背景

`src/background/handlers/entryFrictionHandlers.ts:43-48` の omnibox 経路は `chrome.tabs.query` の結果に `tab.url` が無いと無言で return する。omnibox 起動は activeTab を付与しないため通常サイトでは常にこの分岐に入り、利用者からは「キーワードを打っても何も起きない」に見える。`tabs` 権限の追加は ADR (`dev-docs/ADR/2026-10-07-tab-url-permission-decision.md`) で却下済みのため、権限を増やさずに失敗を可視化するのが本 PBI の範囲である。

## 受け入れシナリオ

### S1: 読めない URL では黙らず理由を返す

Given omnibox から起動され `tab.url` が空の状態で
When ハンドラが実行され
Then 無言 return ではなく、利用者に分かる形 (通知または omnibox サジェスト文) で理由を返す

## 対象

- `src/background/handlers/entryFrictionHandlers.ts:43-48` 付近
- omnibox 応答経路 (`chrome.omnibox.setDefaultSuggestion` / 通知のいずれか。既存の通知機構を再利用する)

## 制約

- `tabs` 権限の追加はしない (ADR 維持)
- 通常系 (URL が読める場合) の振る舞いは変えない

## 完了条件

- [ ] `tab.url` 空の場合に利用者可視のフィードバックがある
- [ ] 既存テストが緑 (`npm run validate` の該当部分)
