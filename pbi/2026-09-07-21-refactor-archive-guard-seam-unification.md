# PBI: Archive ガードの seam 統合 — cutoff ペア検証の 1 箇所化 + StagingName branded type

## ユーザーストーリー
アーカイブ機能の wire 層を保守する開発者として、「cutoffDate と cutoffMs のペアが正しい」「staging 名が有効」という 2 つの検証概念を 1 箇所（`archiveGuards.ts`）と 1 つの型（`StagingName`）に集約したい、なぜなら現状 4 層（panel / validator / SW handler / worker）で検証の強さがバラバラであり、「どこで偽造ペアや未登録 staging 名が落ちるか」が層の通過順序の知識になっていて interface から読めず、弱い層（SW handler の形状チェックのみ）は削除しても何も起きない pass-through だから

## 優先度
- 順位: 02 / 6（本ラウンド）
- RICEスコア: **16.0**（Reach=2.5 / Impact=2 / Confidence=80% / Effort=0.25人週）
- 根拠: 検査コードが validator 5 箇所 + SW handler 9 箇所 + worker 数箇所 + panel 1 箇所に分散。staging 名ゲートは `yasumaro.db` を第二エンジンに開ける穴を防ぐ security 関連の seam（`archiveStaging.ts:8-10` コメント明記）で、これが型で保証される価値は高い。`void isValidStagingName;`（archiveSessionHandlers.ts:236）という「意図をコメントと未使用 import で表現する」コードが存在すること自体が、seam が型化されていない証拠。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ cutoff 検証が 4 層に散在するのか | PBI 2026-09-06-02 で archive 機能を層ごとに実装した際、各層が自己防衛的に検証を足した。純粋関数 `cutoffMsFromLocalDate` は抽出済みだが、実際の不一致ペアの可否は呼び出し側の組み合わせに潜む（locality 欠如の典型） |
| なぜ SW handler のチェックが弱いのか | validator 層（`src/messaging/validators.ts:193-212`）が厳密再導出を行うため、handler は「形状だけ確認しておくか」になっている。同一ファイル内で `archive_create` のみ `yasumaroVersion` 長さ検査を追加し、preview と create で非対称 |
| なぜ staging 名が string のままか | validator は registry を知らない（utils 層）、handler は正規表現を見ない、worker で初めて両方見る — 2 段ゲートの分担が層境界で断裂。branded type があれば「正規表現を通過した名前」だけが型として存在する |
| なぜ `void isValidStagingName;` があるのか | session handlers は registry 発行名しか受け取らないことを文書化するために使っていない import を残している。型で表現できない制約をコメントで誤魔化した跡 |
| 解の粒度 | `assertCutoffPair(cutoffDate, cutoffMs): cutoffMs`（導出 + 一致 + 範囲を一括）を archiveGuards に置き、validator / worker / panel がそれを呼ぶ。`StagingName` branded type を導入し、発行側 `issueName()` と境界デコード 1 箇所でのみ生成可。SW handler の弱チェック 9 箇所と `void` 文を削除 |

## BDD受け入れシナリオ

### Scenario: 偽造された cutoff ペアが 1 箇所で落ちる
  Given `cutoffDate: '2026-09-01'` に対して `cutoffMs` が 2026-08-31T15:00:00Z の値（不一致ペア）
  When `assertCutoffPair(cutoffDate, cutoffMs)` を呼ぶ
  Then throw し、エラーメッセージに期待値（`cutoffMsFromLocalDate(cutoffDate)` の結果）が含まれる。validator 層・worker 層・panel 層はすべてこの関数経由で検証する

### Scenario: 正しいペアは通る
  Given `cutoffDate: '2026-09-01'` と `cutoffMsFromLocalDate('2026-09-01')` の戻り値
  When `assertCutoffPair` を呼ぶ
  Then cutoffMs をそのまま返す（例外を投げない）

### Scenario: staging 名は registry 発行または validator デコード経由でのみ存在する
  Given `StagingName` branded type が導入されている
  When 本番コードから `isValidStagingName` の呼び出し箇所を grep する
  Then 発行側（`archiveStaging.ts` の `issueName`）と境界デコード（validators）のみで、handler 層・session 層の散在チェック（`stagingName.length === 0` 9 箇所、`void isValidStagingName;`）は消えている

### Scenario: 振る舞いが変更前と同一
  Given 既存の archive 関連テスト群
  When 全テストを実行する
  Then エラーメッセージ・ 成功応答が不変で green（弱チェック削除は validator が先に落ちるため観測不可、であることをテストで担保）

## 受け入れ基準
- [ ] `src/utils/archiveGuards.ts` に `assertCutoffPair(cutoffDate, cutoffMs): number` が新設され、`cutoffMsFromLocalDate` による再導出 + 厳密一致 + 範囲（未来日許容幅を含む）を一括検証する
- [ ] `src/messaging/validators.ts` の cutoff 検証（:193-212 相当）が `assertCutoffPair` 経由になり、再導出ロジックの直接記述が消える
- [ ] `src/offscreen/opfsWorker/archiveCreateHandlers.ts:52-60`（`resolveCutoffMs`）が `assertCutoffPair` 経由になる（worker 側の fail-closed 再検証は維持）
- [ ] `src/dashboard/panels/diagnostic/archivePanel.ts:69-74` の入力時導出が `assertCutoffPair` 経由になる
- [ ] `StagingName` branded type が導入され、発行側 `issueName()` と validator 境界デコードでのみ生成される。wire 上の型（sqliteMessages の payload）は `string` のまま維持
- [ ] `archiveHandler.ts` の `stagingName.length === 0` チェック 9 箇所と `archiveSessionHandlers.ts:236` の `void isValidStagingName;` が削除されている
- [ ] SW handler への到達前に validator が必ず走る経路であることを、テストまたは既存の dispatch 順序確認で明示している（弱チェック削除の安全性根拠）
- [ ] `archiveGuards.test.ts` に `assertCutoffPair` の新規テスト（一致・不一致・未来日境界・空文字）が追加され green
- [ ] 既存の archive 関連テスト（validators / archiveHandler / archiveStaging / archiveSession / archivePanel）が green
- [ ] `npm run type-check` / `npm run lint` / `npx vitest run src/utils src/messaging src/background/handlers/dashboardSqlite src/offscreen` が green

## テスト戦略
- 単体: `assertCutoffPair` の網羅テスト（一致 / 不一致 / 未来日 +2 日境界 / 過去日 / 空文字 / 非有限数）
- 単体: `StagingName` 生成経路のテスト（`issueName` は有効名、branded 型の型レベル検証は type-check で担保）
- 回帰: 既存 archive テスト群が green（エラーメッセージ変更が生じた場合は「振る舞い不変」の原則に従い現行文言を維持すること）
- 非対象: registry の実装変更、staging ファイル命名規則の変更

## 実装アプローチ
1. `archiveGuards.ts` に `assertCutoffPair` を追加（既存 `cutoffMsFromLocalDate` を内部利用）
2. validators → panel → workerCreate の順に呼び出しを置換（SW handler は置換ではなく削除）
3. `StagingName` 型を `archiveGuards.ts`（または `archiveStaging.ts`）に定義。`issueName()` の戻り値型を `StagingName` に。validators のデコードで `isValidStagingName` 通過後に `as StagingName`
4. handler の空文字チェック 9 箇所と `void` 文を削除
5. dispatch 順序（validator → handler）の根拠を確認（`MessageRouter` の DASHBOARD_SQLITE 経路を読み、validator が先に走ることを確認。走らない経路があれば該当 case のチェックは維持して注記）
6. テスト追加・全検証

## 見積もり
1 pt（0.25 人週相当）

## 未解決事項
1. `archiveHandler.ts` の `archive_create` のみにある `yasumaroVersion` 検査（1-64 文字）を validators 側へ寄せるか → 実装時に validator 側へ寄せる方針で結論（handler は薄くなる。文言は現行維持）
2. `StagingName` の型定義置き場所（archiveGuards か archiveStaging か）→ validator が import できる中立位置（archiveGuards）に置く。循環が生じる場合は archiveGuards 内型として再確認

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] 検証ロジックの本番編集点が archiveGuards 1 箇所 + worker fail-closed 1 箇所に集約されている（grep で確認）
- [ ] `void isValidStagingName;` と handler 空文字チェック 9 箇所が削除されている
- [ ] コードレビュー完了
- [ ] `npm run type-check` / `npm run lint` / archive 関連テスト green
