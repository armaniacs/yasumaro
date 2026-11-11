# PBI: Viewと配線の値import循環の解消

## ユーザーストーリー
開発者として、dashboardのsqliteHistory系モジュール間のimport循環が解消されてほしい、なぜならViewと配線が互いを参照する構造は将来の変更で循環が拡大し、バンドラやテストの解決順に依存した壊れ方をするから。

## 優先度
- 順位: 2/3 (Round 1)
- RICE: 3.0 (Reach=3 / Impact=1 / Confidence=1.0 / Effort=1)
- 根拠: 前回ラウンド台帳送り (holistic-1107b追記) の再検討トリガー (dashboard/panels変更時) が本ラウンドで発火。変更はimport先付け替えのみで挙動不変。
- 依存: なし

## 現状 (file:line付き・要実装時再確認)
- `sqliteHistoryPanelView.ts` ⇔ `sqliteHistoryChromeWiring.ts` / `sqliteHistoryConfirmDialogs.ts` の値import循環。ChromeWiring側がViewの `formatDate` / `SQLITE_HISTORY_IDS` を参照している。
- 実行時無害 (遅延使用・全テスト緑) だが構造的負債。

## BDD受け入れシナリオ

```gherkin
Scenario: 循環なしで画面が従来通り描画される
  Given sqliteHistoryパネルを開く
  When 一覧・日付・IDが描画される
  Then 表示内容は変更前と一致する (golden/parity)

Scenario: モジュール間に循環依存がない
  Given 関連モジュールのimportグラフを辿る
  When View・配線・ダイアログ間の依存方向を確認する
  Then 一方向 (配線→View等の単方向) で循環がない
```

## 受け入れ基準
- [x] (1) `formatDate` の参照がutils直参照に寄せられ、Viewへの依存が断たれる
- [x] (2) `SQLITE_HISTORY_IDS` の参照が共有SSOTに寄せられ、Viewへの依存が断たれる (Model不触のため等価措置。新規 `sqliteHistoryIds.ts` に所有権を移し3者ともそこから参照)
- [x] (3) 関連モジュール間の値import循環がゼロになる (madgeまたは同等の静的確認/目視grep)
- [x] (4) golden/parityテストで描画内容一致が検証される
- [x] (5) 既存のdashboard系テストが全件緑を維持する

## テスト戦略
- parity/goldenテスト: 変更前後の描画HTML・日付表示をpinしてから置換。
- 循環検出: import方向の静的チェック (簡易grepまたはmadgeがあれば)。
- 回帰: dashboard panels配下テスト全件実行。

## 見積もり
- S

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され、すべてパスする
- [x] コードレビューが完了している
- [x] 受け入れ基準のすべての項目が満たされている

## 出典
- holistic-1107b台帳送り「View⇔新モジュール循環」の再検討 (Round 1で着手)
