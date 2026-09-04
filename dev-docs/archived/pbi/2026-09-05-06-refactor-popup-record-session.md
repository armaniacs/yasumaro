# PBI 06: ポップアップ記録フローを RecordSession 状態機械に集約

優先度: 6 位 / RICE 10.0 = (5 × 2 × 80%) / 0.8w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch3.md](2026-09-05-00-backlog-arch3.md)
依存: なし（他 6 件と独立）

## ユーザーストーリー
ポップアップを保守する開発者として、「Record Now」クリック→取得→preview→保存→結果表示の一連が 1 つの `RecordSession` 状態機械に集約されてほしい。なぜなら現状は 6 モジュール（orchestrator 370 行・preview 163 行・force 88 行・fetcher 101 行・shim 32 行・statusPanel 487 行）に分散し、`ForceRecordFlow` が 5 コールバック束を逆向きに渡す制御反転でボタン状態機械がどこにも存在せず、`statusPanel` が毎更新で `recordBtn.onclick` を書き換えるから。

## BDD受け入れシナリオ

```gherkin
Scenario: 通常記録が状態遷移どおりに完走する
  Given fake fetcher/preview アダプタを注入した RecordSession
  When  start() を実行する
  Then  idle → fetching → saving → done の順に遷移し、ボタンが結果表示になる

Scenario: private-page で force 確認状態になる
  Given PRIVATE_PAGE_DETECTED を返す fake
  When  start() を実行する
  Then  awaiting-force 状態になり、「それでも記録」ボタンが出る
  And   start(force=true) で保存が完走する

Scenario: キャンセルが安全に中断する
  Given fetching/previewing 状態のセッション
  When  cancel() を実行する
  Then  finally リセットと競合せず idle に戻る
```

## 受け入れ基準
- [x] `RecordSession` が `start(force)` / `cancel()` の narrow interface を持ち、状態（idle/fetching/previewing/saving/done/error/awaiting-force）を1箇所で所有する
- [x] `PreviewFlow` / `ForceRecordFlow` がセッションの private 分岐になる（5 コールバック束の制御反転が解消される）
- [x] `SpinnerManager` / `ErrorPresenter` が private helper 化または削除される
- [x] `statusPanel` の `recordBtn.onclick` 書き換えが削除される（調査で判明: `main.ts` は別モジュールの hook に書き込み、`statusPanel` の hook は本番で never-set のデッドコード。削除で本番振る舞い不変）。`getCleansedReasonText` 重複は誤検出（`previewPresenter.ts` は存在せず、定義は `statusPanel.ts` のみ）のため対象外
- [x] `MANUAL` / `PREVIEW` / `SAVE` 3連＋`ACTIVITY_UPDATE` の choreography がセッション内に集約される
- [x] 既存 popup suite が green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- fake fetcher/preview アダプタでセッションを駆動（DOM・live tabs なし）。cancel・private-page・force-retry パスを網羅
- 状態遷移表テスト（全遷移の許可/禁止）
### 統合テスト
- 既存 popup ハーネステストは無修正で green（外部振る舞い不変）
### 例外ハンドリング
- fetch 5s race タイムアウト・権限 ladder（per-origin → opt-in all_urls）の振る舞い不変

## 実装アプローチ
- **Outside-In**: `RecordSession` の状態遷移表と adapter（Fetcher / Preview / Messenger / Button）から設計 → flow を private 分岐に畳む → onclick 書き換えを排除

## 見積もり
0.8w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: DOM 読み書きと chrome messaging を注入 adapter の背後に。タイマは注入可能に
- 非機能要件: ボタン文言・i18n キー・メッセージ型は不変。`recordCurrentPage.ts`（32 行 shim）は互換 re-export として残してよい

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "isAwaitingForceConfirm|isShowingResultState|onclick" src/popup/recordCurrentPage/recordOrchestrator.ts src/popup/statusPanel.ts
rg -n "getCleansedReasonText" src/popup/statusPanel.ts src/popup/recordCurrentPage/previewPresenter.ts
```
2026-09-05 時点: orchestrator 370 行（flags 2 つ :27-30、コンストラクタ注入 5 点 :32-38）、`resetRecordButton` が onclick プロパティ代入（:76-91、意図的とコメントあり）。statusPanel 487 行が `recordBtn.onclick` を毎更新で書き換え。force flow（88 行）は 5 コールバック束を受け取る。

### 実装手順
1. `RecordSession` の状態遷移表と adapter 型を定義
2. fetcher → preview/save の順にセッション内へ移動（各ステップで既存テスト green）
3. force 分岐を private 化し、コールバック束を削除
4. statusPanel の onclick 書き換えを排除し、badge 重複を一本化
5. fake 駆動の新規テスト追加

### 落とし穴
- `start()` の再入ガードは `running` のみを拒否する。`awaiting-force` からの force 再開と `showing-result` からの再開は元コードで許容されていたため維持（UI 上ボタン無効で実質到達不能）。`showing-result` を拒否すると逐次テスト呼び出しが止まる
- `previewFlow.run` の `mockResolvedValueOnce` は消費されないと後続テストにリークする（`clearAllMocks` は Once キューを消さない）。不要な Once は置かないこと
- `resetRecordButton` の onclick プロパティ代入は「重複登録防止の意図」がある — セッション化で不要になるが、意図をコメントに残すこと
- `finally` ブロックのリセットと `isShowingResultState` の競合が既知のバグ温床。遷移表で明示的に潰すこと
- copy-button コンテナ生成の silent-fail は振る舞いを変えず、セッション内に集約するだけに留める

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] popup 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（popup の状態機械図があれば同期）
