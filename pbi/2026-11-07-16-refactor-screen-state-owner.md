# PBI 16: 画面 state の単一所有者化 (sqliteHistory Panel/Model)

## ヘッダ

- 種別: refactor
- 順位: 2 / 5 (arch-delivery-loop round)
- RICE: 0.8 (R=4 / I=2 / C=0.8 / E=8)
- 依存: なし (本 PBI が先行。PBI 17 と PBI 18 は本 PBI の完了後に同一ファイル群で実行する)
- 見積: 8 SP
- プライバシー: 外部送信の追加なし、鍵関連の移動なし

## ユーザーストーリー

保守担当者として、`sqliteHistory` 画面の状態所有者を `SqliteHistoryModel` に集約したい。`pendingSearchQuery` の debounce 状態と `pendingPages` の storage 購読が Panel 側に残り、`collection` 引渡し前の同期的 flush 順序に依存した hack が残っているため、順序を誤ると検索入力が欠落するからだ。

## 背景

画面は約 9 モジュールに分割されている (要確認)。View 分割は現状維持とし、本 PBI では Panel と Model の境界だけを扱う。振る舞い変更は行わない。

確認済み事実:

- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:435-442`: `SqliteHistoryModelDeps` (`queryHistory`, `getSqliteStatus`, `scheduler`, `onStateChange`) を定義する。
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:537-540`: `createSqliteHistoryModel(deps)` が model を生成する。`SqliteHistoryModel` は 20 メソッドを持つ (要確認)。
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:51-73`: Panel が `pendingSearchQuery` (`string | null`)、`pendingPages`、`pendingNavParams`、および storage 購読 (`unsubscribePendingStorage`) を Panel local state として保持する。
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:350-365`: `flushPendingSearch()` が `collection` 引渡し前に同期 flush する順序依存の hack である。
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:433-439`: debounce timer の発火側にも flush 分岐がある。

目標は、`pendingSearchQuery` の debounce 状態と pending-pages 購読を Model 側へ移動し、`collection` 引渡し前の同期的 flush 順序 hack を削除することである。代替案として、分割を意図的と判断した場合は、その理由を記録し、順序契約を test で固定する。実装者がどちらかを選択し、選択理由を記録すること。

## BDD 受け入れシナリオ

```gherkin
Scenario: debounce 中の検索入力が collection 引渡しで欠落しない
  Given 検索欄に入力が入り debounce timer が未発火である
  When send-to-collection 操作を実行する
  Then Model が最新の query を保持している
  And 引渡し結果は入力後の state と一致する

Scenario: pending-pages の更新が Model 経由で一貫して届く
  Given Model が pending-pages の購読所有者である
  When chrome.storage の pending pages が変化する
  Then Model の state が更新される
  And Panel は subscribe 経由の再描画だけで反映する

Scenario: 分割を残す場合は順序契約が test で固定される
  Given Panel/Model の状態分割を意図的として残す判断をした
  When fill+click-send の順序で操作する
  Then flush が引渡しより先に実行されることが test で保証される
  And 判断理由がコードコメントまたは ADR に記録されている
```

## 受け入れ基準

- [ ] `pendingSearchQuery` の debounce 状態の所有者が Model または Panel のいずれかに単一化されている。
- [ ] pending-pages の storage 購読の所有者が Model または Panel のいずれかに単一化されている。
- [ ] `flushPendingSearch` の順序依存が解消されているか、意図的分割として順序契約が test で固定されている。
- [ ] 選択結果 (移動または意図的分割) とその理由がコードコメントまたは PBI 記録に残っている。
- [ ] View 分割に変更がなく、公開 UI の振る舞いに変更がない。
- [ ] PBI 17 と PBI 18 が同一ファイル群で後続実行できる状態になっている。

## テスト戦略

- 既存の panel suites を実行し、検索 debounce、pending-pages 更新、collection 引渡しの回帰がないことを確認する。
- 順序契約を固定する test (fill+click-send 相当) を追加または更新し、flush 順序の保証を明示する。
- `npm run type-check` を実行し、`SqliteHistoryModelDeps` と Panel/Model 境界の型破損がないことを確認する。
- 新規の振る舞いは追加せず、Outside-In で公開導線の結果が変わらないことを確認する。

## DoD

- [ ] 受け入れ基準をすべて満たす。
- [ ] 既存 panel suites が成功する。
- [ ] `npm run type-check` が成功する。
- [ ] 振る舞い変更がないことを確認した。
- [ ] View 分割を維持した。
- [ ] 外部送信と鍵関連の移動がないことを確認した。
