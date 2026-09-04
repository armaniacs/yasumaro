# PBI 15: contentKernel から DeadlineTimer モジュールを抽出

優先度: 5 位 / RICE 13.3 = (5 × 1 × 80%) / 0.3w / Strength: Worth exploring
backlog: [2026-09-04-00-backlog-arch2.md](2026-09-04-00-backlog-arch2.md)

## ユーザーストーリー
コンテンツスクリプトの訪問判定を保守する開発者として、deadline スケジューリングと閾値キャッシュ無効化が 1 つの深いモジュールにまとまってほしい。なぜなら現状 3 メソッドに分散したキャッシュ三組（thresholds/gate/startTime）の整合維持が読みにくく、スケジュールポリシー変更が visit 判定に触れるから。

## BDD受け入れシナリオ

```gherkin
Scenario: 閾値変更後に再スケジュールすると期限が再計算される
  Given DeadlineTimer に init 時の閾値がキャッシュされている
  When  pageState.minVisitDuration が変更され schedule が呼ばれる
  Then  deadline が新しい閾値から再計算される

Scenario: throttle と watchDynamicContent は kernel の外から利用できる
  Given DeadlineTimer 抽出後の ContentKernel
  When  init が実行される
  Then  throttle と watchDynamicContent は別モジュールから import され、kernel ファイル内に実装が存在しない
```

## 受け入れ基準
- [x] `content/deadlineTimer.ts`（または同等モジュール）に deadline/キャッシュ無効化/スケジュールが抽出される
- [x] contentKernel は visit-state orchestration（checkVisitConditions/updateMaxScroll/report）のみに縮小
- [x] throttle と watchDynamicContent が kernel ファイルから移動（挙動不変）
- [x] 既存 content suite（406 tests）が green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- DeadlineTimer: schedule/stop/閾値 drift での再計算（既存 polling テストの移行）
### 統合テスト
- contentKernel.polling.test.ts が DeadlineTimer 経由で green

## 実装アプローチ
- **Outside-In**: 既存 polling テストが通る形で抽出（テストは kernel 経由のまま、内部実装のみ移動）

## 見積もり
0.3w

## 技術的考慮事項
- 依存関係: なし（PBI 02 の直後の深耕）
- テスタビリティ: DeadlineTimer は Scheduler seam を受け取る

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "deadlineMs|refreshCachesIfStale|throttle|watchDynamicContent" src/content/contentKernel.ts
```
:373-423（scheduling）、:396-411（refreshCachesIfStale）、:496-530（throttle — rAF 汎用、他消費者あり）、:549-610（watchDynamicContent — MutationObserver スタンドアロン）。

### 実装手順
1. `deadlineTimer.ts` を新設: `class DeadlineTimer(deps: { scheduler, clock, getPageState, isE2ETest })` が scheduleNextCheck/stop/refreshCachesIfStale を所有
2. contentKernel を委譲に置換（既存 polling テスト無修正で green がゴール）
3. throttle → `content/throttle.ts`（または既存共有先）へ移動
4. watchDynamicContent → `content/watchDynamicContent.ts` へ移動し kernel の 1 行ラッパを削除（import 直接）

### 落とし穴
- throttle は extractor 側でも使う可能性（コメント記載「shared with extractor for backward compat」）— 移動先で両方 import できる位置に
- watchDynamicContent の debounce 500ms は SPA 対応（6.7.89 30-13）の挙動 — 変更禁止
- E2E フック（__OW_TEST_STATE / data-ow-test-state）は checkVisitConditions 側 — DeadlineTimer 移動で壊さない

## Definition of Done
- [x] 既存 content suite 406 tests 無修正で green
- [x] contentKernel.ts から throttle/watchDynamicContent 実装が消える
- [x] コードレビュー完了
- [x] ドキュメント更新（不要: 内部リファクタリング）
