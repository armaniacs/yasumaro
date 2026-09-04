# PBI 17: persistSort のテストシーム漏洩を PersistScheduler adapter で解消

優先度: 7 位 / RICE 8 = (2 × 1 × 80%) / 0.2w / Strength: Strong
backlog: [2026-09-04-00-backlog-arch2.md](2026-09-04-00-backlog-arch2.md)
依存: PBI 11 に続いて同一ファイルへ着手

## ユーザーストーリー
Dashboard 履歴のソート永続化を保守する開発者として、タイミングポリシー（500ms debounce / 即時）が注入可能な seam になっていて本番モジュールからテスト検出ロジックが消えてほしい。なぜなら isFakeTimersActive()/isTestEnv() の分岐が 2 つの重複書き込みブロックを生み、本番コードがテストハーネスの内部を知っている状態は drift の温床だから。

## BDD受け入れシナリオ

```gherkin
Scenario: 本番スケジューラは 500ms debounce で永続化する
  Given 本番用 PersistScheduler（setTimeout 500ms）が注入されている
  When  changeSort が 5 回連続で呼ばれる
  Then  500ms 後に persist が最後の値で 1 回だけ呼ばれる

Scenario: テストは即時スケジューラを注入して同期的に検証する
  Given 即時実行の PersistScheduler が注入されている
  When  changeSort が呼ばれ flush される
  Then  persist が同期的に呼ばれる（500ms 待機不要）
```

## 受け入れ基準
- [x] `isFakeTimersActive()` / `isTestEnv()` が sqliteHistoryModel.ts から消える
- [x] PersistScheduler seam（defer(fn, ms) / cancel）が注入可能になる
- [x] 本番既定は 500ms setTimeout、unmount で flush（既存挙動維持）
- [x] sort-persistence テストが注入で同期検証に更新される
- [x] 既存 asyncData suite 全绿

## テスト戦略（t_wadaスタイル）
### 単体テスト
- PersistScheduler: defer → 500ms 後実行 / cancel / flush
### 統合テスト
- changeSort 5 連続 → 最後の値で 1 回（本番 scheduler注入 + fake timers でも可）

## 実装アプローチ
- **Outside-In**: sort-persistence テストの同期検証を注入で実現する形から設計

## 見積もり
0.2w

## 技術的考慮事項
- 依存関係: PBI 11 の後に着手（同ファイル）
- テスタビリティ: scheduler 注入で fake timers 不要に

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "isFakeTimersActive|isTestEnv|schedulePersistSort|flushPendingPersist" src/dashboard/panels/asyncData/sqliteHistoryModel.ts
```
:375-443 に分岐本体（:417 `const useTimer = isFakeTimersActive() || !isTestEnv()`、:421-426 vs :434-441 の重複書き込みブロック）、:666-674（changeSort）、:595-598（unmount flush）。

### 実装手順
1. `PersistScheduler` 型 + 本番実装（500ms setTimeout）を定義（同ファイル上部または historyQueryCache.ts と並ぶ位置）
2. createSqliteHistoryModel のオプションに scheduler を追加（既定 = 本番実装）
3. schedulePersistSort を schedule/flush へ委譲に統一（重複ブロック削除）
4. sort-persistence テストを注入版に更新（既存の同期検証を維持）

### 落とし穴
- unmount（bumpGenerationOnUnmount）の flush を壊さない — テストで固定
- 本番 scheduler は chrome.storage.local.set を呼ぶ — テスト注入時は fake storage

## Definition of Done
- [x] isFakeTimersActive/isTestEnv がモデルから消える
- [x] 単体/統合テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（不要: 内部リファクタリング）
