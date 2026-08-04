# PBI: ダッシュボード複数タブで AI テスト進捗が干渉しないようにする

**作成日**: 2026-08-04
**優先度**: 低（次リリース以降でよい）
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（メッセージに相関 ID を追加するのみ、単一タブ運用に影響なし）
**種別**: fix（レビュー指摘: SRE/Ops [Low]）

---

## 背景（5 Whys 分析）

Checking Team レビューの SRE/Ops Specialist [Low]「進捗pushがsender非依存ブロードキャストのため複数ダッシュボードタブで相互干渉する」を起点とする。

### 5 Whys

- **Why 1**: なぜ2つのダッシュボードタブで干渉するのか？
  → どちらも同じ `chrome.runtime.onMessage` broadcast を受信し、`latestProgress` を相手タブの進捗で上書きするため。
- **Why 2**: なぜ上書きするのか？
  → 進捗メッセージに「どのテスト実行に属するか」の相関 ID が無く、受信側が自分のリクエスト由来か判定できないため。
- **Why 3**: なぜ相関 ID が無いのか？
  → 単一ダッシュボード運用を前提に設計し、複数ウィンドウ・複数タブの同時実行を想定していなかったため。
- **Why 4**: なぜ同時実行を想定しなかったのか？
  → ダッシュボードは通常1タブで開かれ、並行テストのユースケースが想定されていなかったため。
- **Why 5**: なぜ今対処する価値があるのか？
  → broadcast + リスナー方式の今回の変更で、進捗表示が相手タブに「目に見える形で」混ざるようになったため。将来のマルチウィンドウ対応の土台になる。

### 根本原因
進捗メッセージに実行ごとの相関 ID が無く、受信側が自分の実行の進捗だけを描画できない設計だった。

### 対処
`AiTestProgress` に実行ごとの相関 ID（runId）を追加し、ダッシュボードは自分の生成した runId の進捗のみ描画する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 他タブの進捗を無視する
  Given タブAが自分の runId=X でテストを開始する
  When runId=Y の進捗メッセージが届く
  Then タブAは runId=X の進捗のみ描画し、runId=Y の進捗は無視する

Scenario: 自分の進捗は従来通り描画される
  Given タブAが runId=X でテストを開始する
  When runId=X の進捗メッセージが届く
  Then プロバイダー名・進捗が描画される
```

## 受け入れ基準
- [ ] `AiTestProgress` に runId（文字列）が追加される
- [ ] ダッシュボードは自分の runId の進捗のみ描画する
- [ ] 単一タブ運用では従来と同一の挙動（回帰なし）
- [ ] 既存の進捗表示テストがパスする

## テスト戦略
- 単体: `src/dashboard/__tests__/dashboard-handlers.test.ts` に「異なる runId の進捗を無視」「同一 runId の進捗を描画」を追加
- `aiClient` 側は runId を生成・伝播するため、進捗コールバックテストを更新

## 実装アプローチ
- `AiTestProgress` へ runId 追加 → `handleTestAi` で実行ごとに runId を生成 → notifier/メッセージへ伝播 → 受信側でフィルタ → テスト

## Definition of Done
- [ ] runId による干渉防止が実装済み
- [ ] 対応テストが追加され全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- レポート: `plans/2026-08-04-1950-review-v6.7.12-ai-test-progress.md`（SRE/Ops Specialist Low）
- 対象コード: `src/background/aiClient.ts`, `src/background/aiTestProgressNotifier.ts`, `src/dashboard/dashboard.ts`
