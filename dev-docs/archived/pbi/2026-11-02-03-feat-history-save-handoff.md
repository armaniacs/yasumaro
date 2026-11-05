# PBI: history から保存へのハンドオフと recall 規約の固定

## ユーザーストーリー

ダッシュボード利用者として、履歴で絞り込んだ条件を手入力なしでコレクション保存したい。recall した条件がどこに反映されるか (履歴一覧かコレクションパネルか) が曖昧なままでは、将来の改修者がどちらを正とすべきか分からなくなるから。

## 優先度

- 順位: 3 / 7
- RICEスコア: 0.72（Reach=0.6 / Impact=1.5 / Confidence=80% / Effort=0.5人週）
- 根拠: PBI 2026-11-01-06 の決着を含む。recall 適用先の一本化が本体。

## BDD受け入れシナリオ

Scenario: 履歴の絞り込みをコレクション草稿に送る
  Given 履歴で語・タグ・日付を絞り込んだ
  When 「コレクションに送る」を押す
  Then コレクションパネルの editor に三条件が復元され、命名・保存はコレクション側で行う (その場保存はしない)

Scenario: 空の絞り込みは送れない
  Given 絞り込み条件がない
  When 「コレクションに送る」を押す
  Then 送られず、条件が必要な旨が履歴側に表示される

Scenario: recall 適用先はコレクション草稿に一本化される
  Given 保存済みコレクションがある
  When 呼び出す
  Then コレクションパネルの editor に復元される (履歴一覧への適用はしない)

## 受け入れ基準

- [ ] 履歴パネルに「コレクションに送る」導線を追加し、state 三つ組 (search/tag/selectedDate) の全文転送で editor 草稿に復元する (命名・保存はコレクション側のみ)
- [ ] カスタム範囲選択中は保存を拒否し、理由を表示する (単日 date に潰さない。`collectionRangeUnsavable` 相当)
- [ ] ドロップする条件 (domain/starred 等、将来 state が持った場合) があるときは警告表示する仕組みを用意する (現行 state に無いため配線のみでも可。黙って落とさない)
- [ ] recall 適用先を collections panel の draft (`applyToDraft`) に一本化し、history の `applyCollection` は v1 のみ受ける legacy 経路として doc に明記する
- [ ] recall 適用先の pin テストを追加する (適用先=panel-saved-collections draft)
- [ ] 完了後は PBI 2026-11-01-06 をアーカイブする
- [ ] `?tab=collections` の回帰を壊さない

## テスト戦略

- E2E: 履歴の絞り込み→送信→editor 復元の通し
- 単体: 空条件・カスタム範囲の拒否テスト
- 統合: recall 適用先 pin テストの追加
- 回帰: 履歴パネル E2E の既存通し

## 見積もり

0.5人週

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (SETUP_GUIDE の履歴節と recall 規約)
- [ ] PBI 2026-11-01-06 をアーカイブ済み
