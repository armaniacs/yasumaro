# PBI: 履歴パネルのスリム化と文書更新

## ユーザーストーリー

ダッシュボード利用者として、切り離し後の履歴パネルを記録一覧と検索操作だけに絞ってほしい。保存・質問・報告の入口が新パネルに移った後も履歴に残骸が残ると、どこで何をするのか分からなくなるから。

## 優先度

- 順位: 4 / 4
- RICEスコア: 0.72（Reach=0.4 / Impact=1 / Confidence=90% / Effort=0.5人週）
- 根拠: スコアは最上位だが、PBI 01〜03 への依存により最後に実施する。新パネルが受け皿として動いてから履歴側を削る。

## BDD受け入れシナリオ

Scenario: 履歴パネルは記録操作だけになる
  Given PBI 01〜03 の新パネルが動作している
  When 履歴パネルを開く
  Then 記録一覧と検索操作だけが表示され、3リージョンの配線が残っていない

Scenario: 古い履歴リンクは壊れない
  Given `?tab=history` のリンクがある
  When そのリンクを開く
  Then 履歴パネルが開く

Scenario: 新パネルの深いリンクが開く
  Given 新パネルの深いリンクがある
  When そのリンクを開く
  Then 対応する新パネルが開く

## 受け入れ基準

- [ ] 履歴シェルから保存済みコレクション・履歴に聞く・調査レポートの3リージョン配線を削除する
- [ ] catalog 順が `panel-sqlite-history` → `panel-saved-collections` → `panel-ask-history` → `panel-research-report` → `panel-archive` となる
- [ ] `?tab=history` の回帰テストが通り、新パネルの深いリンクが対応するパネルを開く
- [ ] `docs/SETUP_GUIDE.md` と `README.md` の履歴節を新パネル構成に合わせて更新する
- [ ] 編集した文書が文字種チェックを通る
- [ ] 記録パイプライン本体の挙動を変えない

## テスト戦略

- E2E: `?tab=history` と新パネル deep-link の回帰（既存 deep-link テストの更新）
- 統合: catalog と sidebar・分類の同期テスト更新
- 単体: 履歴リージョン描画テストの整理（削除・移設の対応付け）

## 見積もり

0.5人週

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（SETUP_GUIDE と README の履歴節）
