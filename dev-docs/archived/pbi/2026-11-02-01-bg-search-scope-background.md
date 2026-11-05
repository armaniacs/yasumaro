# PBI: search scope 開通の background 半分

## ユーザーストーリー

ダッシュボード利用者として、語とタグ・日付を組み合わせた検索で正しい件数と一覧を得たい。現行は dashboard から validator までは転送されるが、background で落とされるため、コレクションのプレビュー件数と recall 結果が語のみの過大な件数になるから。

## 優先度

- 順位: 1 / 7
- RICEスコア: 1.44（Reach=0.6 / Impact=2 / Confidence=80% / Effort=0.33人週）
- 根拠: c8522f2b の残り半分。offscreen (`planSearch`/`extraWhere`) は対応済みで、直すのは background 3点のみ。

## BDD受け入れシナリオ

Scenario: 語とタグの複合検索が絞り込む
  Given タグ付き記録が存在する
  When 語とタグを指定して検索する
  Then タグに合う記録だけが返り、total も絞り込み後の件数になる

Scenario: 語のみ検索は従来どおり
  Given 任意の記録がある
  When 語だけを指定して検索する
  Then 余分な field なしで送信され、従来と同じ結果になる

Scenario: 日付範囲が検索に効く
  Given 複数日の記録がある
  When 語と since/until を指定して検索する
  Then 範囲内の記録だけが返る

## 受け入れ基準

- [ ] `readOnlyHandler.ts` の `buildSearchParams` が payload の tagFilter/since/until を抽出して `deps.search` に渡す
- [ ] `ReadOnlyDeps.search` (`deps.ts`) の options 型に tagFilter/since/until を追加する
- [ ] `sqliteWireTable.ts` の search `encodeOp/encodePayload` が scope を運ぶ (QueryOp search 型の拡張を含む)
- [ ] `dashboardSqliteService.searchLogs` の呼び出し側 (`createSqliteClientDeps` の search 実装) が scope を `sqliteClient.query({kind:'search', ...})` に載せる
- [ ] 既存の projection pin (`readOnlyProjection-pins.test.ts`) と dispatch pin (`dispatch-seams.test.ts`) を更新する
- [ ] offscreen 側の変更はしない (対応済みのため)
- [ ] `queryHistory` の tagFallback 挙動を変えない (`tagInitiated: false` の manual 経路は代替検索に入らないこと)

## テスト戦略

- 単体: `buildSearchParams` の scope 抽出テスト (tagFilter/since/until の有無両方)
- 単体: wire encode の scope 保持テスト (余分 field なし呼び出しが field-free のままであること)
- 統合: dashboard search → background → offscreen の複合検索が絞り込むこと (既存 search hop 契約テストの拡張)
- 回帰: tagFallback・dispatch・projection の既存 pin 全緑

## 見積もり

0.33人週

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (本 PBI 範囲のみ。仕様変更のため SETUP_GUIDE の該当があれば更新)
