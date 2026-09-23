# PBI: dashboard 読み取り経路の cap policy を planner seam に単一所有させる

種別: refactor / 見積もり: 1pt

## ユーザーストーリー

dashboard の読み取り結果を利用する開発者として、limit の上限政策が offscreen の planner seam に単一所有されていてほしい。background の読み取り handler が独自に clamp すると、cap 緩和の適用漏れで経路ごとに上限が食い違うから。

## 優先度

順位 4 / RICE 24（Reach 6 / Impact 2 / Confidence 1.0 / Effort 0.5週）

根拠: LAYERS 違反（background から offscreen への静的 import）が lint の盲点のまま残り、同一 limit に対する cap 政策が 3 箇所に分散所有されている。現時点で user-facing の不具合は出ていないが、cap 変更時に 3 箇所の同期が必須という構造的負債であり、放置すれば適用漏れが上限不一致として表面化する。Effort は clamp 2 件の削除と import 除去に fts 既定値の pin テストを加えた小規模であり、費用対効果が確定している。

## ビジネス価値

- cap 政策の変更点が 1 箇所になり、緩和や引き締めの適用漏れが構造的に起きない
- background と offscreen の層境界が wire table ヘッダの禁止則どおりに戻り、層違反の静的 import が増殖しない
- 読み取り上限の振る舞いがテストで pin され、将来の上限変更が意図的になる

## BDD受け入れシナリオ

```gherkin
Feature: dashboard 読み取り上限は planner seam が単一所有する

  Scenario: plain query の上限超過は planner で clamp される
    Given dashboard から subtype query で limit に上限超過値が送られる
    When readOnlyHandler が alias 投影だけを行い offscreen に渡す
    Then planQuery と applyReadPolicy を経た limit が plain cap に clamp される
    And background 側の事前 clamp がなくても最終 rows の件数が変わらない

  Scenario: fts search の既定 50 が planner 側で再現される
    Given dashboard から subtype search で limit 未指定が送られる
    When readOnlyHandler が limit を加工せずに渡す
    Then planner 経路の最終 limit が fts 経路の既定 50 になる
    And 既存の dashboardSqlite readOnly テストの期待値が変更なしで通る

  Scenario: background が offscreen を静的に import しない
    Given readOnlyHandler の import 文の一覧
    When offscreen 配下への静的 import の有無を検査する
    Then clampLimit と QUERY_CAPS の直接 import が存在しない
```

## 受け入れ基準

- [x] `buildListParams` が limit を clamp せず、wire 値を alias 投影としてそのまま渡す
- [x] `buildSearchParams` が limit を clamp せず、既定 50 を含む上限政策を planner 側に委ねる
- [x] `readOnlyHandler.ts` が `offscreen/queryPlan.js` を静的に import しない
- [x] fts 経路の既定 50 が planner 側のテストで pin されている
- [x] 既存の dashboardSqlite readOnly テストの期待値が変更なしで通る
- [x] 全 BDD シナリオが実装されパスする

## テスト戦略

t_wada スタイルの Outside-In で、振る舞い不変を先に固定してから内部の clamp 所有者を移す。手順は RED-GREEN-REFACTOR の順に回す。

1. RED: planner 経路に fts 既定 50 と plain 上限の pin テストを追加し、background の事前 clamp を外しても最終 limit が同一になることを失敗条件として記述する
2. GREEN: `buildListParams` と `buildSearchParams` から clamp 2 件を削除し、alias 投影専用にしてテストを通す
3. REFACTOR: `offscreen/queryPlan.js` への静的 import を除去し、必要なら `messaging/limits.ts` 経由の中立再エクスポートに付け替える。既存の dashboardSqlite readOnly テストを全件実行し、期待値変更なしを確認する
4. 統合検証 green をもって挙動不変とみなす。新規の振る舞い追加はこの PBI の範囲外とする

## 実装アプローチ

1. `readOnlyHandler.ts` の `buildListParams` から `clampLimit(payload.limit, QUERY_CAPS.plain, 100)` を除去し、limit は wire 値の alias 投影として渡す
2. `buildSearchParams` から `clampLimit(payload.limit, QUERY_CAPS.fts, 50)` を除去し、fts 既定は planner 側の再現に委ねる
3. `offscreen/queryPlan.js` への直接 import（`clampLimit` と `QUERY_CAPS`）を削除する。cap 値が background 側でどうしても必要な場合は `messaging/limits.ts` 経由の中立再エクスポートを使う
4. offscreen 側は信頼境界として `planQuery` と `planSearch` に `applyReadPolicy` を適用し、`buildQuerySpec` の防御的再 clamp を残す。`audit_log_query` が既に採用済みの素通し方針（planAuditLog に委譲）を query と search にも拡張する形にする
5. fts 既定 50 の pin テストを追加し、既存の dashboardSqlite readOnly テストの期待値変更なしを確認する

## 見積もり

1pt（0.5 人週）。clamp 2 件の削除と import 除去に pin テスト追加を含む小規模 refactor であり、新規振る舞いは追加しない。

## 技術的考慮事項

- offscreen が信頼境界であるため、background の事前 clamp を外しても `planQuery` と `planSearch` の `applyReadPolicy` と `buildQuerySpec` の再 clamp が最終上限を保証する
- `QUERY_CAPS` の単一定義は `messaging/limits.ts` にあり、`offscreen/queryPlan.ts` は再エクスポートにすぎない。background が cap 値を参照する必要がある場合は中立層経由に限定し、層違反の再発を防ぐ
- `buildQuerySpec` の防御的再 clamp は残す。planner 所有への一本化と二重防御の除去を混同せず、今回は background 側の重複だけを消す
- 失敗シナリオ: cap 緩和が 3 箇所のうち 1 箇所だけに適用されると経路間で上限が不一致になる。LAYERS 違反の静的 import が lint の盲点のまま増殖すると将来の分離がさらに困難になる
- `planPurge` 系のコメントが記録済みの同方針（wire 値は seam で正規化し、各層で再導出しない）を踏襲する

## 実装者向け注記

- `src/background/handlers/dashboardSqlite/readOnlyHandler.ts:5` の `import { clampLimit, QUERY_CAPS } from '../../../offscreen/queryPlan.js'` が wire table ヘッダの禁止則に違反する。`src/messaging/sqliteWireTable.ts:15-19` は background から offscreen への import を forbidden と明記し、同ファイル 23-27 行目付近は dashboard 読み取り経路の payload 政策が層政策であり wire codec ではないと記録している
- `src/background/handlers/dashboardSqlite/readOnlyHandler.ts:27` の `clampLimit(payload.limit, QUERY_CAPS.plain, 100)` と同ファイル 49 行目付近の `clampLimit(payload.limit, QUERY_CAPS.fts, 50)` が今回削除対象の clamp 2 件である
- `src/offscreen/queryPlanner.ts:38-43` の `applyReadPolicy` が正規化済み query に対する再 clamp の所有者であり、同ファイル 50-61 行目付近の `planQuery` と `planSearch` が wire payload からの正規の入口である
- `src/offscreen/queryPlan.ts:254` の `QUERY_CAPS` は `messaging/limits.ts` の再エクスポートであり、単一定義は中立層にある。同ファイル 265 行目付近の `clampLimit` と 316-360 行目付近の `buildQuerySpec`（359-360 行目付近で `useFts` に応じた cap を選んで再 clamp）が防御側の重複 clamp を構成する
- `src/background/handlers/dashboardSqlite/readOnlyHandler.ts:104-113` の `audit_log_query` 経路は cap と offset の政策を offscreen の `planAuditLog` に委譲する素通し方針の先例であり、`src/offscreen/queryPlanner.ts:86-94` の `planAuditLog` がその seam である。query と search もこの形に寄せる

## Definition of Done

- [x] 全 BDD シナリオが実装されパスする
- [x] コードレビューが完了している
- [x] 統合検証が green である
