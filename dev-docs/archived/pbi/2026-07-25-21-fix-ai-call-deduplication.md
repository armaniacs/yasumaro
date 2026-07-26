# PBI: 同一URLへのAI要約呼び出しの並行重複を防止する

**作成日**: 2026-07-25
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（in-flightリクエスト管理を追加するため、既存の並行記録フローに影響しないか確認が必要）

## 実装メモ（2026-07-26）

`AIClient.generateSummary()` に `inFlightSummaryRequests: Map<string, Promise<AISummaryResult>>` を追加。
キーは `${url}::${tagSummaryMode}`（url空文字列時は重複排除対象外）。既存ロジックは `generateSummaryInternal()`
に切り出し、外側のラッパーで in-flight チェック・登録・`finally`でのクリーンアップを行う。
`src/background/__tests__/aiClient.test.ts` に5件のテストを追加（同一URL集約・異なるURL独立・完了後の再試行・
空文字列URLの対象外・失敗時のクリーンアップ）。全27件パス。

**確認事項**: `reviewSummaryGenerator.ts` は `AIClient.generateSummary()` を呼ぶがurlを渡していないため、
この重複排除の対象外（意図通り — 呼び出しごとに新しい `AIClient` インスタンスを生成しており、
週次/月次ダイジェスト生成の重複制御は別レイヤーの問題であり本PBIのスコープ外）。

---

## 背景

Checking Team レビュー（2026-07-25）の FinOps Consultant からの指摘。`src/background/aiClient.ts:77` の `generateSummary()` および `src/background/reviewSummaryGenerator.ts:208, 277` のダイジェスト生成箇所で、in-flightリクエストの重複排除やデバウンス機構が見当たらない。複数タブから同時に同一URLへの記録処理が走った場合、同一コンテンツへのAI呼び出しが重複し、不要なAPIコストが発生する可能性がある。

`src/background/recordingLogic.ts` の `cacheState`（96-283行）は設定・URLキャッシュ用であり、AI呼び出し自体の重複防止ではないことを確認済み。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "generateSummary" src/background/aiClient.ts src/background/recordingLogic.ts
grep -n "inFlight\|pending" src/background/recordingLogic.ts src/background/aiClient.ts
```

`checkDuplicateStep.ts`（既存の重複チェックステップ）が同一URLの並行記録自体を防いでいないか、パイプライン全体を通して確認する。記録レベルの重複防止と、AI呼び出しレベルの重複防止は別レイヤーであることに注意。

## 受け入れ基準（BDD）

```gherkin
Scenario: 同一URLへの並行リクエストが1回のAI呼び出しに集約される
  Given 同一URLに対する記録リクエストが同時に2つ発生する
  When 両方が generateSummary() を呼び出そうとする
  Then AI APIへの実際の呼び出しは1回のみ発生する
  And 両方のリクエストが同じ結果を受け取る

Scenario: 異なるURLへの呼び出しは並行して処理される
  Given 異なる2つのURLへの記録リクエストが同時に発生する
  When 両方が generateSummary() を呼び出す
  Then それぞれ独立してAI API呼び出しが行われる
```

## 受け入れ基準
- [ ] `generateSummary()` に in-flight リクエストのマップ（URLまたはコンテンツハッシュをキーとする）を導入する
- [ ] 同一キーのリクエストが既に処理中の場合、新規リクエストは新しいAPI呼び出しを行わず、既存の Promise を再利用する
- [ ] 完了後（成功・失敗問わず）は in-flight マップからエントリを削除する
- [ ] 既存の `aiClient` / `recordingLogic` テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 同一キーで並行呼び出しした場合、内部のfetch/API呼び出しモックが1回しか呼ばれないことを確認
- 異なるキーでの並行呼び出しはそれぞれ独立して呼ばれることを確認
- 完了後にin-flightマップがクリアされることを確認（次回呼び出しで再度APIが呼ばれる）

### 統合テスト
- `recordingLogic.ts` 経由での複数タブ同時記録シナリオで重複APIコールが発生しないことを確認

## 実装アプローチ

1. `aiClient.ts` に `Map<string, Promise<Result>>` 形式の in-flight リクエストマップを追加
2. `generateSummary()` の冒頭でキー（URL or コンテンツハッシュ）をチェックし、既存Promiseがあれば再利用
3. `finally` でマップからエントリを削除

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: なし
- 非機能要件: コスト削減（FinOps）、パフォーマンス

## Definition of Done
- [ ] in-flightリクエスト重複排除が実装されている
- [ ] 並行呼び出しでAPI呼び出し回数が1回に集約されることがテストで確認されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（FinOps Consultant指摘）
- 対象コード: `src/background/aiClient.ts:77`, `src/background/reviewSummaryGenerator.ts:208, 277`
