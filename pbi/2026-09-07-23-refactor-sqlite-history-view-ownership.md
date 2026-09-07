# PBI: sqliteHistoryPanel の描画所有権を View に一本化 — 二重レンダーパスと DOM ID seam 漏洩の解消

## ユーザーストーリー
SQLite 履歴パネルの見た目と描画を保守する開発者として、Panel（610 行）と View（358 行）の間で描画の所有権が分断されているのを View 1 箇所に集約したい、なぜなら Panel 内に `updateDynamicRegions()`（差分更新）と `renderState()`（フル再構築）の 2 つの描画パスが併存して calendar / sort / list / pagination の描画とコールバック束を二重記述しており、View は HTML 文字列だけ作って Panel が `getElementById` を 12 箇所から再取得するため、ID 5 種が View / Panel / CSS / テストに 33 箇所漏洩して View を直さず Panel だけ変えることもその逆もできないから

## 優先度
- 順位: 04 / 6（本ラウンド）
- RICEスコア: **8.0**（Reach=2 / Impact=2 / Confidence=80% / Effort=0.4人週）
- 根拠: `sqlite-search-input / sqlite-sort-control / sqlite-calendar-nav / sqlite-entry-list / sqlite-pagination` の ID 参照は grep 33 ヒット。履歴パネルはユーザーが最も頻繁に触る画面で、見た目変更のたびに View と Panel の同時修正が発生。legacy panel-history 撤去（PBI 16・保留中）とは無関係の、現行 SQLite パネル単体の摩擦。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 2 つの描画パスが併存するのか | 差分更新（パフォーマンス）とフル再構築（初期化・復帰）が別タイミングで実装され、共通の render 入口が設計されなかった。`refresh()`（:544-550）が `isPanelMounted()` で分岐するだけの thin dispatcher |
| なぜ View が HTML だけなのか | View が「文字列を作るだけ」で、リスナー配線と DOM 再取得を Panel が所有している。`buildXxxHtml` と `wireXxx` が分離していないため、ID という seam を跨いだ密結合（33 ヒット）になった |
| なぜコールバック束が二重なのか | `onDateSelect / onToggleStar / onDelete / onSelectionChange / onTagFilterClick / onContentToggle` 等を 2 パスがそれぞれ渡している。追加のコールバックは 2 箇所同時更新 |
| なぜ View を削除すると壊れるのか | View は Panel のコールバック束なしでは振る舞えない — これは seam が本物（2 adapters）ではなく仮説的である証拠。render と wire を 1 つの interface にすれば seam が本物になる |
| 解の粒度 | View が `buildXxxHtml + wireXxx(container, callbacks)` ペアを公開、Panel は `view.render(container, state, callbacks)` 1 呼び出しのみ。差分/フルの分岐は View 内部 1 箇所に |

## BDD受け入れシナリオ

### Scenario: Panel から getElementById が消える
  Given 描画所有権が View に一本化された後の `sqliteHistoryPanel.ts`
  When `getElementById|querySelector` を grep する
  Then sqlite-history 関連の DOM ID 直取得が Panel から消え（widget 取得の共通ヘルパーまたは View へ移動）、ID 定数は View が唯一の所有者である

### Scenario: 単一の render 入口で差分とフルが切り替わる
  Given `view.render(container, state, callbacks)` が単一入口
  When state が変化した場合
  Then 差分/フルの判定は View 内部 1 箇所で行われ、Panel は 2 つの描画メソッドを直接呼ばない

### Scenario: 振る舞いが変更前と同一
  Given 既存の sqliteHistoryPanel / lifecycle / migration 系テスト
  When 全テストを実行する
  Then green（fixture の ID 参照維持。DOM 構造・data-i18n・a11y 属性は不変）

## 受け入れ基準
- [ ] `sqliteHistoryPanelView.ts` に render + wire の単一入口が実装され、`buildXxxHtml` と `wireXxx` がペアで公開される
- [ ] `sqliteHistoryPanel.ts` の `updateDynamicRegions()` と `renderState()` の二重記述が解消され、描画分岐が View 内部 1 箇所に集約されている
- [ ] Panel から sqlite-history 関連の `getElementById` 直取得（12 箇所相当）が消え、View または共有ヘルパー経由になる
- [ ] ID 5 種（sqlite-search-input / sqlite-sort-control / sqlite-calendar-nav / sqlite-entry-list / sqlite-pagination）の参照が View 中心に集約されている（テスト fixture の参照は許容）
- [ ] コールバック束（onDateSelect / onToggleStar / onDelete / onSelectionChange / onTagFilterClick / onContentToggle 等）が 1 箇所で構築される
- [ ] `data-i18n` / aria 属性 / focus 管理の振る舞いが不変（a11y 回帰なし）
- [ ] 既存テスト（lifecycle / migration / panel）が green（fixture 変更は ID 文字列の直接参照を型や定数に寄せる場合のみ許容）
- [ ] `npm run type-check` / `npm run lint` / dashboard テスト green

## テスト戦略
- 回帰: sqliteHistoryPanel 系テスト（lifecycle / migration / 各フィルタ）を無修正 or 最小修正で green。振る舞い不変の担保
- 単体: View の render 入口テスト（state → DOM 構造の決定性。差分/フル両パスが同じ終状態になること）
- a11y: 既存の keyboard 操作テスト（ADR 2026-04-19）が green
- 非対象: SqliteHistoryModel の interface 変更（台帳「21 → 8 メソッド」は本 PBI 着地後に再評価）、legacy panel-history（PBI 16 保留中）

## 実装アプローチ
1. View に `render(container, state, callbacks)` を実装。内部で `updateDynamicRegions` 相当（差分）と `renderState` 相当（フル）を持ち、判定を 1 箇所に
2. Panel の 2 描画メソッドと 12 箇所の `getElementById` を View 呼び出しに置換
3. コールバック束を Panel の 1 箇所（`createCallbacks()` 相当）に集約し View に渡す
4. テスト fixture の ID 参照は ID 定数（View が export）経由に寄せる（文字列直参照の解消）
5. a11y / i18n 属性の不変性を確認しつつ全検証

## 見積もり
2 pt（0.4 人週相当）

## 未解決事項
1. 差分更新の粒度（list のみ差分、それ以外フル等）を View 内部の最適化としてどこまで残すか → 体感劣化がなければ「フル再構築 1 パス」への単純化を優先し、計測してから戻す。実装メモに記録
2. `updateTagFilterBar`（:183-232）と legacy `historyFilters.updateTagFilterIndicator` の関係 — legacy 撤去（PBI 16）待ちのため本 PBI では触らない

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] Panel から sqlite-history DOM ID 直取得が消えている（grep で確認）
- [ ] 二重レンダーパスが View 1 箇所に集約されている
- [ ] a11y（keyboard 操作）と i18n 属性が不変（テスト green）
- [ ] コードレビュー完了
- [ ] `npm run type-check` / `npm run lint` / dashboard テスト green
