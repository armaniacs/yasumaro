# PBI: ContentKernel の teardown 対称化と SPA ナビゲーション検出の協調クラス化

## ユーザーストーリー
保守担当者として、contentKernel の SPA ナビゲーション検出 (~250 行) を協調クラス (SpaNavigationMonitor) に切り出し、init の teardown 資産を保持したい、なぜなら現在は kernel 内に inline 実装され、SPA 検出方式の変更が 797 行の kernel 全体の編集を強いられ、さらに init 成功経路の subscription が誰にも保持されず (unsubscribe の戻り値破棄、anonymous リスナー 3 種)、テストで複数回 init した場合にリスナーが積み上がる構造だから (holistic レビュー テーマ 5 + 2、同一変更セット)。

## ユーザーへの背景 (レビュー報告書: テーマ 5 [影響度: 低 | 難易度: 低] + テーマ 2 [影響度: 中 | 難易度: 低]、ロードマップ 2-3 位)
- SPA 検出の所在: subscribeSpaNavigation (contentKernel.ts:438-467)、startSpaUrlPolling (:477-496)、pollSpaUrlOnce/getLastSpaUrl/readSpaUrl (:504-523)、maybeResetForSpaUrl (:532-558)、状態 4 つ (:636-652)、periodic との相互再起動配線 (:622-633, 654-668)
- teardown の所在: init で unsubscribePause 取得 (:693) するが成功経路では破棄 (:731 戻り値破棄、:732-763 anonymous リスナー、:654-668 stopPeriodicCheck はリスナーを外さない)
- 前例: ScrollMonitor / VisitGating / DeadlineTimer / VisitReporter の協調クラスパターン (constructor:104-150)

## ビジネス価値
- SPA 検出方式の変更 (URL 正規化規則、ポーリング間隔) が 797 行 kernel の編集を要求しなくなる
- SPA 部分だけを独立駆動できる単体テストが可能になる (kernel 全体構築が不要)
- テストの複数 init が構造的に安全になる
- 測定方法: SpaNavigationMonitor が純粋関数 (stripUrlFragment 比較) でモックなしにテスト可能であること、kernel の init → dispose 契約が pin されること

## BDD受け入れシナリオ

```gherkin
Scenario: SPA 検出は協調クラスで動作する
  Given SpaNavigationMonitor が依存注入で生成されている
  When history pushState が発生する
  Then onNavigation が呼ばれ、kernel は resetForNavigation を実行する (挙動不変)

Scenario: dispose で全 subscription が解放される
  Given kernel init が完了し、SPA subscription と window/document リスナー 3 種が登録されている
  When kernel.dispose() が呼ばれる
  Then stopPeriodicCheck が実行され、全解除関数が実行される (リスナー残骸なし)

Scenario: SPA 検出判定は純粋関数でテストできる
  Given SpaNavigationMonitor の判定ロジック (stripUrlFragment 比較) が純粋関数として分離されている
  When fragment のみが異なる 2 URL で判定する
  Then 同一 URL と判定される (モックなし)
```

## 受け入れ基準
- [ ] `src/content/spaNavigationMonitor.ts` (新規) に SpaNavigationMonitor クラスと判定純粋関数が移設されている (subscribeHistory、startPolling、pollOnce、getLastUrl)
- [ ] contentKernel.ts は kernel 内の SPA 専用状態 4 つと 4 メソッドを削除し、constructor で SpaNavigationMonitor を生成する
- [ ] init 成功経路の全解除関数が disposers 配列に保持され、`dispose()` が提供されている (unsubscribePause 含む)
- [ ] 匿名リスナー 3 種 (scroll、beforeunload、visibilitychange) が named function に置き換えられている
- [ ] contentKernel 既存テスト群が緑 (外部挙動不変)
- [ ] SpaNavigationMonitor の純粋関数単体テスト (モックなし) が存在する
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (既存 content E2E が経路を通る)

### 統合テスト
- contentKernel 既存テスト群 (外部挙動不変で緑)

### 単体テスト
- SpaNavigationMonitor 純粋関数 (fragment 比較、URL 正規化)、dispose 契約 (全解除関数の呼び出し)

## 見積もり
S-M (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-28-0145-holistic-review-1128a.md テーマ 5 (改善案スケッチ :127-147) + テーマ 2 (SpaNavigationMonitorDeps スケッチ :46-59)、ロードマップ 2-3 位 (同一変更セット)
- 外部挙動: 完全に不変 (SPA 検出の挙動、reset タイミングは同一。disposers 化とクラス移設のみ)
- 依存関係: なし (contentKernel と新クラス)
- 抽象化の追加ではない: 既存 4 協調クラスと同一のパターン (YAGNI 上、第 2 の URL 正規化規則など先走り機能は導入しない)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '438,558p' src/content/contentKernel.ts
sed -n '636,668p' src/content/contentKernel.ts
sed -n '674,768p' src/content/contentKernel.ts
grep -n "subscribeSpaNavigation\|getLastSpaUrl" src/content/extractor.ts | head -5
```

### 実装手順
1. SpaNavigationMonitor クラス新設 (subscribeHistory、startPolling、pollOnce、getLastUrl、判定純粋関数)
2. kernel 内の SPA 状態 4 つと 4 メソッドを削除、constructor で生成
3. init 成功経路の disposers 配列 + dispose() 実装 (named function 化を含む)
4. extractor.ts の SPA facade は SpaNavigationMonitor への委譲に統一
5. テスト: 純粋関数単体 + dispose 契約 + kernel 既存テスト群

### 落とし穴
- kernel 内の SPA 判定 (stripUrlFragment 比較、:58-61) は純粋関数として移設する (クラス状態に依存しない部分を先に切り出すと移設が安定する)
- extractor.ts:118-155 が re-export する 5 API の消費者 (viewer や selectionCapture) の確認を忘れない (API 名は維持)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ロールバック手段: クラス化前の実装に戻す (1 コミット)
- [ ] ドキュメント更新の要否判定: 内部構造のため docs 更新は不要
