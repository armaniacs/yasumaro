# PBI: statusPanel からの信頼・権限フロー抽出（trustPanel モジュール化）

## ユーザーストーリー

保守者として、statusPanel.ts に混在する信頼・権限フローと全 URL バナーを自己完結した trustPanel モジュールへ抽出したい。renderer / store 抽出後も 468 行が残り、init 制御・バナー・ホワイトリスト配線・フィードバックボタンが 1 ファイルに詰め込まれ、変更の影響範囲が読み取りにくいからだ。

## 優先度

- 種別: refactor
- 順位: 10 / 20
- RICEスコア: 8.0（Reach=5 / Impact=2 / Confidence=0.8 / Effort=1.0 SP）
- 根拠: 約 120 行の自己完結フロー抽出で statusPanel の責務配置が明確になる。Confidence 0.8 は rank-16 との同一ファイル調整が必要なため。
- 依存: rank-16（statusPanel.ts:29 の as-unknown-as 清掃）と同一ファイルで競合するため、本分割を先に実施するか統合順序を調整する。

## 背景

- `src/popup/statusPanel.ts` — renderer / store 抽出後も 468 行で複数責務が混在。
  - init 制御 + 信頼・権限フロー: `:139-216`（permissionManager の動的 import を含む）
  - 全 URL バナー: `:392-426`
  - ホワイトリスト配線: `:334-390`
  - フィードバックボタン: `:428-467`
- 信頼・権限フロー + バナー（約 120 行）は自己完結しており、trustPanel モジュールへ抽出可能。
- init のモードバッジ取得（`:34-47`）は本質的な責務ではない。

## BDD受け入れシナリオ

```gherkin
Scenario: 信頼・権限フローは trustPanel モジュールとして動作する
  Given 信頼・権限フローと全 URL バナーが trustPanel モジュールへ抽出されている
  When ポップアップを開く
  Then 権限確認、バナー表示、trust 判定の動作は変更前と同一である
  And permissionManager の動的 import も同等のタイミングで機能する

Scenario: 抽出後も statusPanel の残存責務に回帰がない
  Given trustPanel 抽出後の statusPanel が init 制御・ホワイトリスト配線・フィードバックボタンを保持する
  When 既存のポップアップ導線を実行する
  Then ホワイトリスト配線とフィードバックボタンの動作は変更前と同一である
```

## 受け入れ基準

- [ ] 信頼・権限フロー（`:139-216`）と全 URL バナー（`:392-426`）が trustPanel モジュールへ抽出されている。
- [ ] 抽出されたモジュールは自己完結し、statusPanel からの配線で接続されている。
- [ ] statusPanel.ts の行数が削減され、init 制御・ホワイトリスト配線・フィードバックボタンの責務配置が明確になっている。
- [ ] permissionManager の動的 import の挙動が維持されている。
- [ ] パリティテストにより、抽出前後で UI 動作（バナー、trust 判定、権限フロー）が同一であることを確認している。
- [ ] rank-16 との統合順序（本分割を先に実施するか調整）が確定している。
- [ ] `npm run validate` が成功している。

## テスト戦略（t_wadaスタイル）

### 単体テスト

- trustPanel の単体テストを新設し、バナー表示条件、trust 判定、権限フローの状態遷移を検証する。非同期は実時間待ちで待たない（`testDir/waitPolicy.ts` のヘルパーを使う）。

### 統合テスト（パリティ）

- 抽出前の既存テストを基準に、抽出後もポップアップ全体の観測可能な動作が変わらないことをパリティ検証する。
- permissionManager の動的 import を含む経路を `vi.hoisted()` モックまたは DI で検証する。

## 見積もり

**1.0 SP**

trustPanel 抽出、statusPanel からの配線、パリティテストの新設、rank-16 との統合順序調整を含む。

## Definition of Done

- [ ] trustPanel モジュールへの抽出が完了している。
- [ ] statusPanel の残存責務に回帰がない。
- [ ] パリティテストが整備されている。
- [ ] 動的 import の挙動が維持されている。
- [ ] rank-16 との統合順序が確定している。
- [ ] `npm run validate` が成功している。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
