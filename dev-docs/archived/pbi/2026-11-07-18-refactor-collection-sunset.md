# PBI 18: collection v1 restore sunset と collection 実行系の集約

## ヘッダ

- rank: 4/5 (arch-delivery-loop round)
- RICE: 0.3 (R3 / I1 / C0.8 / E8)
- depends: 2026-11-07-16 (完了後に着手すること。`sqliteHistoryModel.ts` を共有するため)
- estimate: 8SP
- privacy: exfiltration なし、鍵移動なし
- v2 動作変更: なし

## ユーザーストーリー

履歴表示の利用者として、古い形式 (v1) で保存された collection を開いても失わずに draft へ引き継いでほしい。なぜなら v1 実行系を削除しても過去の保存が読めなくならないことが保守の前提だからである。

## 背景

- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:509` で `applyCollection` が v1 専用 legacy として deprecated 指定されている。`src/dashboard/panels/asyncData/sqliteHistoryModel.ts:518` の `applyCollectionQuery` が v2 実行系である。
- `src/dashboard/panels/asyncData/collectionHistoryQuery.ts:67` の `orderCollectionRows` が merge 後の `created_at` 順序を担い、`src/dashboard/panels/asyncData/collectionHistoryQuery.ts:86` の `resolveCollectionHistory` が clause 単位の fan-out と merge を行う。UNION 相当の結合は同ファイルの merge 箇所 (`mergeClauseResults` 呼び出し付近) で行い、`MAX_COLLECTION_ROWS` での切り詰めは同ファイルの slice 箇所で行う。
- `src/dashboard/panels/asyncData/savedCollectionQuery.ts:46` の `parseCollectionQuery` が v1 flat 形式 (search/tag/date) の parse を担う。
- `src/dashboard/panels/asyncData/historyHandoff.ts:54` の `buildHistoryHandoffQuery` が history の filter triple を collection query record へ束ねる draft handoff の入口である。
- `src/dashboard/panels/asyncData/savedCollectionsPanel.ts:215` および `:241` では表示層の `applyCollection` が `applyToDraft` へ配線済みであり、model の `applyCollection` に本番配線は残っていない (test のみが参照)。
- 要確認: `src/dashboard/panels/asyncData/historyQueryCache.ts:57` と本件の関係は未確認である。query seam の裏側が cache か `queryHistory` 直結かを実装前に再確認すること。
- 要確認: 依存先 `2026-11-07-16` の PBI ファイルが `pbi/` に存在しない。本件着手前に台帳へ登録済みか確認すること。

目的は v1 restore の sunset (migrate-on-read で draft handoff へ寄せた後に `applyCollection` を削除する) と、parse と merge と order を `queryHistory` seam の背後の一つの collection 実行モジュールに寄せることである。

## BDD 受け入れシナリオ

```gherkin
Scenario: v1 形式の保存を開くと draft へ引き継がれる
  Given v1 flat 形式の保存 (search と tag と date のみ) が存在する
  When 利用者がその保存を開く
  Then migrate-on-read により内容が draft 側へ引き継がれる
  And v1 実行系 (`applyCollection`) は呼び出されない

Scenario: v2 collection の実行結果は変わらない
  Given v2 形式の保存 (clauses と op と pins) が存在する
  When 利用者がその保存を実行する
  Then `resolveCollectionHistory` による fan-out と UNION 相当の merge と `orderCollectionRows` による順序と `MAX_COLLECTION_ROWS` による上限が従来通り適用される

Scenario: 不正な保存は安全に閉じる
  Given 形式不明の query record が存在する
  When 利用者がその保存を開く
  Then 例外を投げずに空条件へ閉じる
  And 履歴一覧は破壊されない
```

## 受け入れ基準

- [x] v1 形式の restore は migrate-on-read 経由で draft handoff (`buildHistoryHandoffQuery` 系) へ引き継がれる
- [x] sunset 完了後は model の `applyCollection` が削除され、本番参照と test 参照が残らない
- [x] v2 実行 (`applyCollectionQuery` / `resolveCollectionHistory`) の振る舞いに変更がない (順序、上限、warning を含む)
- [x] parse と merge と order が `queryHistory` seam 背後の一つの collection 実行モジュールに集約される
- [x] 不正形式の入力は例外なく空条件へ閉じる
- [x] privacy 観点で外部送信と鍵移動の追加がない

## テスト戦略 (t_wada 式 Outside-In)

順序は migrate-on-read path を先にし、削除は最後にする。

### E2E 相当 (最小限)

- v1 保存を開いて draft に引き継がれること
- v2 保存の実行結果が sunset 前後で変わらないこと

### 統合テスト (中程度)

- migrate-on-read: v1 record -> `parseCollectionQuery` -> draft handoff query への変換契約
- collection 実行: `queryHistory` seam に fake を注入し、fan-out と merge と order と cap の契約を確認
- `historyQueryCache.ts` の有無にかかわらず cache 経由と直結の両配線で結果が一致すること (要確認の箇所はここで確定させる)

### 単体テスト (多数)

- `parseCollectionQuery` の境界値 (空文字、空白のみ、不正型は空条件へ閉じる)
- `orderCollectionRows` の同値 `created_at` 時の id tie-break と ASC/DESC
- `mergeClauseResults` の AND/OR と pins 結合
- `MAX_COLLECTION_ROWS` 超過時の切り詰めと warning 付与

### 移行期間の約束

- `applyCollection` 削除までは legacy restore 系 test (`sqliteHistoryModel.applyCollection.test.ts`、`sqliteHistoryModel.handoff.test.ts`、`sqliteHistoryModel.navigate.test.ts`) を green のまま保つ
- 削除は migrate-on-read が green になった後に行い、削除時に test 側の参照も同時に更新する

## 実装アプローチ

- Outside-In: migrate-on-read の受け入れ test (失敗) から開始し、統合、単体の順に内側へ進む
- Red-Green-Refactor: 各層で TDD cycle を回す
- 集約は移動のみとし、v2 の SQL 意味と上限と順序は変えない

## 技術的考慮事項

- 依存関係: `2026-11-07-16` 完了が前提 (`sqliteHistoryModel.ts` の競合回避)
- 非機能要件: 追加の外部通信なし、既存の上限 (`MAX_COLLECTION_ROWS`、`MAX_COLLECTION_FANOUT`、`MAX_QUERY_IDS`) を変更しない
- テスタビリティ: `runQuery` / `queryHistory` seam と同等の DI 形状を維持し、fake 注入可能に保つ

## 実装者向け注記

### 現状コードの確認

着手前に必ず以下を実行すること。

```bash
grep -rn "applyCollection" src/dashboard/panels/asyncData/
grep -rn "resolveCollectionHistory\|orderCollectionRows\|mergeClauseResults\|MAX_COLLECTION_ROWS" src/dashboard/panels/asyncData/collectionHistoryQuery.ts
```

`applyCollection` に本番呼び出しが復活していないか確認すること。`savedCollectionsPanel.ts` の adapter が `applyToDraft` を向いていることが前提である。

### 実装手順

1. migrate-on-read の受け入れ test を追加し失敗を確認する
2. v1 parse から draft handoff query への変換を実装する
3. parse と merge と order を collection 実行モジュールへ集約する (振る舞い不変)
4. legacy restore 系 test が green であることを確認する
5. `applyCollection` 本体と test 側参照を削除し、全 test を再実行する

### 落とし穴

- v1 の単日 date と custom range を混同しないこと (custom range は handoff が拒否する)
- AND 時の clause window (`MAX_AND_CLAUSE_WINDOW`) と OR 時の row cap を取り違えないこと
- pin 解決の欠損 (削除済み id) は除外して数えること

## Definition of Done

- [x] 全 BDD シナリオが自動 test として実装され pass する
- [x] legacy restore 系 test が削除前まで green であり、削除後に参照が残らない
- [x] v2 の順序と上限と warning に差分がない
- [x] コードレビュー完了
- [x] リファクタリング完了 (green 後)
- [x] ドキュメント更新済み
