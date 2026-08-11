# PBI: SQLite history panelのstate遷移をreducerへ統一する

## ユーザーストーリー

開発者として、SQLite history panelのすべてのstate変更を一つのreducer経路へ統一したい。なぜなら、直接mutationとreducerの二重経路による挙動ドリフトをなくし、state遷移のlocalityとtestabilityを高めたいから。

## ビジネス価値

- reducerのテストが実際のpanel操作を保証する。
- pagination、filter、selection、loading/errorの規則が一箇所に集約される。
- state変更時の副作用と表示更新の追跡コストを下げる。

## 実装済み確認

関連する`historyStateReducer`と直接mutationは既に存在する。これは新規機能追加ではなく、既存実装の二重経路を解消する改善PBIである。

```bash
rg -n "historyStateReducer|state\\.[A-Za-z]+\\s*=|selectedIds\\.(add|delete|clear)" src/dashboard/panels/asyncData/sqliteHistoryPanel.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: 検索・日付・tag filterの変更がreducerを通る
  Given SQLite history panelが表示されている
  When 検索、日付範囲、tag filterのいずれかを変更する
  Then state変更はreducer actionとして適用される
  And panel内に同じstateを直接変更する経路が存在しない
  And currentPageとfallback状態が定義された規則に従う

Scenario: paginationとselectionの変更がreducerを通る
  Given SQLite history panelに履歴と選択状態がある
  When ページ変更、行選択、全選択、選択解除を実行する
  Then state変更はreducer actionとして適用される
  And Setの直接add/delete/clearはpanel操作経路に存在しない

Scenario: loadingとerrorの遷移がreducerを通る
  Given 履歴queryが実行中または失敗する
  When queryが開始、成功、失敗、またはキャンセルされる
  Then loadingとerrorのstateがreducerで更新される
  And stale responseはstateを変更しない
```

## 受け入れ基準

- [ ] `sqliteHistoryPanel.ts`のstate変更がreducer経由に統一される。
- [ ] `SqliteHistoryAction`に不要なactionが残らず、実操作と一致する。
- [ ] `selectedIds`の直接mutationがpanel操作経路から除去される。
- [ ] reducer単体テストとpanel統合テストが同じstate契約を検証する。
- [ ] 既存のUI、lifecycle、pagination、filter、sanitizationが維持される。
- [ ] `npm run type-check`、関連テスト、`npm run build`が成功する。

## テスト戦略（Outside-In）

### E2Eテスト

- 履歴画面で検索、tag filter、pagination、selectionを操作し、表示結果を確認する。

### 統合テスト

- panel操作からreducer actionとquery呼び出しが連携することを確認する。
- stale responseとunmount後応答がstateへ反映されないことを確認する。

### 単体テスト

- 全reducer actionの正常系、境界値、error遷移を検証する。
- filter clear時のfallback/searchQuery消去を検証する。
- selection Setの不変性とdelete後のtotal下限を検証する。

## 実装アプローチ

- 既存reducerをpanelの唯一のstate変更経路へ昇格する。
- `refresh`はreducer適用後に呼び出す。
- DOM listenerはaction dispatchだけを行い、storage queryや表示更新は既存経路を維持する。
- 新しいpanel abstractionや全面的なファイル分割は行わない。

## 見積もり

3pt（高）

## 技術的考慮事項

- 依存関係: 既存の`sqliteHistoryPanelState.ts`と`sqliteHistoryQuery.ts`。
- Service Workerは対象外。DashboardのDOM lifecycleを維持する。
- Setはreducer内で新しいSetを返し、既存stateを変更しない。

## Definition of Done

- [ ] BDDシナリオが自動テスト化されパスする。
- [ ] panel内の直接state mutationが除去される。
- [ ] reducerとpanel統合テストが同じ契約を検証する。
- [ ] type-check、validate、buildが成功する。
- [ ] コードレビューが完了する。
