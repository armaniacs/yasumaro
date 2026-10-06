# PBI: i18n モックの手作りコピーが残存し、うち 4 件は仕様逸脱している

## ユーザーストーリー

テストを書く開発者として、i18n モックを共有ファクトリに統一したい。手作りコピーが残り、うち 4 件は subs を無視する逸脱変種で、ファイルごとにテストの検出力が異なるから。

## 優先度

- 順位: 23/32
- RICE: 2.7（R6 / I1 / C0.9 / E2）
- 根拠: テストを書くたびに関わる。逸脱 4 件は検出力の不揃い。NN28 の先行（同一テストファイル群の機械置換）
- 依存: なし（NN28 の先行）

## 背景（file:line 現状）

- 正準: `testDir/i18nMock.ts:13-37` の `mockGetMessage`
- `getMessageWithSubstitutions` を含むファイルは 68、`i18nMock` を参照するファイルは 16（統合側 grep 確認）
- byte 等価コピー（`fallback.replace(/\{(\w+)\}/g, ...)` の同一ボディ）が約 46 箇所。例: `src/popup/__tests__/main.test.ts:127`、`src/dashboard/__tests__/dashboard.test.ts:475`、`src/dashboard/settings/__tests__/trustSettings.test.ts:258` ほか
- **subs を無視する逸脱変種 4 箇所**: `src/dashboard/__tests__/masterPassword-set-guard.test.ts:13-14`、`masterPassword-ui-state.test.ts:12`、`masterPassword-pending-rotation.test.ts:13`、`dashboardLegacyPanelFactories.test.ts:86`。本番が `{name}` を展開する呼び出しでも fallback を返すだけになる
- `vi.mock('.../i18n.js')` の直書きは 68 ファイル
- 閉済 PBI の記録との乖離: 2026-10-03-30（i18n storage mock factories）は「手作りコピーの残存は dashboardLegacyPanelFactories.test.ts の 1 ファイルのみ」と記録していたが実態と異なる

## BDD受け入れシナリオ

```gherkin
Scenario: 手作りコピーが共有ファクトリに統一される
  Given vi.mock の factory が手作り定義のテストファイル
  When mockGetMessage 経由へ機械置換する
  Then 既存の vi.mock 節・beforeEach・アサーションは不変で green のままである

Scenario: 逸脱 4 件が裁定される
  Given subs を無視する 4 件の変種
  When 「本番仕様かテスト都合か」を判定する
  Then 本番が展開するならファクトリへ統一、都合なら i18nMock.ts 内に命名済みヘルパーとして共有され、黙った逸脱が消える

Scenario: 閉済 PBI の記録と実態が一致する
  Given 統一後のリポジトリ
  When 手作りコピーを数える
  Then 残存ゼロ（または命名済みヘルパーのみ）である
```

## 受け入れ基準

- [x] `vi.mock` の factory が `mockGetMessage` 経由へ機械置換されている
- [x] 逸脱 4 件が裁定済み（ファクトリ統一 or 命名済みヘルパー化）
- [x] 既存の `vi.mock` 節・`beforeEach`・アサーションは不変
- [x] NN28（popup テスト DOM 脚手架）と同一ファイルを触る場合は NN21 を先に行い、2 回触りを避ける
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 既存テストの green 維持（置換自体がテスト）。逸脱 4 件の裁定に応じた新規ケース
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 裁定: 逸脱 4 件は全件ファクトリへ統一（命名済みヘルパー不要）。本番は fallback 中の `{name}` を展開し、4 件のスタブは常に truthy を返すため戻り値は不変
- 変更ファイル: 45 ファイルを機械置換（custom `getMessage` 定義は温存、手書きの `getMessageOr` / `getMessageWithSubstitutions` 定義だけを置換）。除外領域（generalSettings/__tests__ / panels / fieldValidation / settingsPipeline 等）は未接触
- 統合修正: 報告された 3 件の失敗は既存不具合ではなく本ラウンドの波及漏れだったため統合側で修正（dashboardLegacyPanelFactories 2 件は NN07 の `rc-` 化の追従漏れ、exportDateSsot golden 1 件は NN11 の `#status` 統一化に伴うフィクスチャの `#status` 不足）
- ゲート: 対象 648 + 404 tests green / type-check PASS / lint 0 errors
