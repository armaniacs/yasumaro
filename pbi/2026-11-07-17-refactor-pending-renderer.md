# PBI 2026-11-07-17 pending renderer 共通化

## ヘッダ

- Rank: 3/5 (arch-delivery-loop round)
- RICE: 0.64 (R4 / I1 / C0.8 / E5)
- Depends: 2026-11-07-16 (完了後に着手。`sqliteHistoryPanel.ts` を共有するため)
- Type: refactor
- Estimate: 5SP
- Privacy: exfiltration なし、key 移動なし

## ユーザーストーリー

開発者として、popup と dashboard の pending 行表示を 1 つの renderer と action-contract にまとめたい。なぜなら 2 箇所の行 HTML と action 形状が別々に進化すると表示差異と二重モックが発生し、保守コストが上がるから。

## 背景

pending 行の描画は現在 2 表面に分散している。popup 側は DOM 組み立て、dashboard 側は HTML 文字列組み立てで、同じ `PendingPage` 型の裏側にあるのに行 HTML と action 形状が別管理になっている。本 PBI では表示ロジックを `PendingPage` 型の背後にある共有モジュールへ寄せ、presenter は表面固有の配線だけを持つ形にする。動作変更なし、markup 差異なしを条件とする。

確認済み実装 (Read で再確認済み、要確認なし):

- `src/popup/pendingPages.ts:39-100` - `loadPendingPages` による checkbox 付き行組み立て (`pending-item`、`pending-checkbox`、`pending-item-title`、`pending-item-reason`) と whitelist 書き込み入口 (`addDomainsOrPathsToWhitelist`)。記録配線は同ファイルの `saveSelectedPages` (`src/popup/pendingPages.ts:122-172`) に続く。
- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:360-435` - `buildPendingRowHtml` (360-377)、`buildPendingRegionInnerHtml` (379-390)、`renderPendingRegion` (398-...) と `data-pending-action` ボタン配線 (`record` / `recordWithoutAi` / `delete`)。
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:68-73` - pending 用の panel-local state (`pendingPages`、`unsubscribePendingStorage`)。`chrome.storage.onChanged` 購読であり、SQLite query pipeline の model state ではない。
- `src/utils/pendingStorage.ts:58-66` - 共有型 `PendingPage` (`url`、`title`、`timestamp`、`reason`、`headerValue?`、`expiry`、`errorMessage?`)。

依存 PBI 2026-11-07-16 が `sqliteHistoryPanel.ts` を先に触るため、本 PBI はその完了後に開始する。競合回避のための順序制約であり、機能依存ではない。

## BDD 受け入れシナリオ

```gherkin
Scenario: popup と dashboard で同じ行 HTML が生成される
  Given 有効な PendingPage が 1 件存在する
  When  popup 用 presenter と dashboard 用 presenter が共有 renderer を呼ぶ
  Then  行 HTML の要素構造と escape 結果が一致する
  And   checkbox 系と record/delete 系の差異は presenter 側の設定差分として分離される
```

```gherkin
Scenario: action-contract 経由で記録と削除が実行される
  Given pending 行が共有 renderer で描画されている
  When  利用者が record または delete の action を発火する
  Then  対応する contract handler (onRecord / onRecordWithoutAi / onDelete) が同じ url で呼ばれる
  And   表面固有の busy 表示と error 表示は presenter 側に残る
```

```gherkin
Scenario: 空リストと上限表示の振る舞いが変わらない
  Given pending list が空または PAGE_SIZE を超える
  When  各表面の presenter が再描画する
  Then  空表示と more-count 表示の有無が従来と同一になる
  And   既存の popup と dashboard のテストが green のままである
```

## 受け入れ基準

- [ ] 共有 pending-row renderer モジュールが `PendingPage` 型の背後に存在し、行 HTML 生成を 1 箇所に集約する
- [ ] 共有 action-contract モジュールが `record` / `recordWithoutAi` / `delete` の形状を定義し、両表面がそれを利用する
- [ ] popup presenter と dashboard presenter は表面固有の配線だけを持ち、行 HTML の重複組み立てを持たない
- [ ] mock は共有モジュールに対して 1 回だけ書けば両表面のテストで再利用できる
- [ ] 描画結果に markup 差異がなく、既存の表示テストの snapshot 更新が不要である
- [ ] 動作変更がなく、記録・whitelist・削除の既存フローがすべて従来どおり通る

## テスト戦略

- popup suite: `loadPendingPages` の DOM 検証を共有 renderer の単体テストへ移し、popup 側は presenter 配線 (checkbox 選択、`saveSelectedPages`、`setupEventListeners`) のテストに絞る。共有 renderer に対する mock は 1 箇所に集約する。
- dashboard suite: `sqliteHistoryPanelView` の `buildPendingRowHtml` / `buildPendingRegionInnerHtml` / `renderPendingRegion` 検証を共有 renderer の単体テストへ寄せ、dashboard 側は region 配線 (`PendingRegionActions`、`withBusyButton`、error 行表示) のテストに絞る。
- 契約テスト: action-contract の `onRecord` / `onRecordWithoutAi` / `onDelete` が両表面から同じ引数形状で呼ばれることを統合テストで確認する。
- 回帰: 既存の popup と dashboard の suite を全件実行し、snapshot 差分なしを確認する。`escapeHtml` と `isSecureUrl` 分岐の境界値 (空 title、`headerValue` 有無、非 secure URL) を単体テストでカバーする。

## 実装者向け注記

- 先に PBI 2026-11-07-16 の完了を確認する。`src/dashboard/panels/asyncData/sqliteHistoryPanel.ts` の差分を取り込んでから分岐する。
- 新規モジュール案: `src/utils/pendingRowRenderer.ts` (行 HTML) + `src/utils/pendingRowActions.ts` (action-contract)。配置は実装時に調整可。
- popup の checkbox モデルと dashboard の button モデルの差は renderer に吸収させない。renderer は行 HTML を返し、選択状態と action 発火は presenter が持つ。
- `escapeHtml`、`clearElement`、`setElementHtml` の既存 seam は維持する。i18n キー (`recordNow`、`recordWithoutAi`、`pendingDeleteForever` など) の解決場所を変えない。
- 範囲外: デザイン変更、文言変更、ソート順変更、PAGE_SIZE 変更は本 PBI に含めない。

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] popup suite と dashboard suite が green である
- [ ] 行 HTML と action 形状が 1 モジュールに集約され、二重 mock が解消されている
- [ ] markup 差異なしがテストで裏付けられている
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (本 PBI 以外のファイル変更は実装 PR 側で扱う)
