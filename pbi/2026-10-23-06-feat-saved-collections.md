# PBI: 保存済みコレクション ― 検索条件と自動タグ規則の永続化

## ユーザーストーリー
調べ物をする人として、検索条件とタグ付けを名前付きで残したい、なぜなら毎回作り捨ての集計では振り返りと出力(M1/M3)に渡せないから

## 優先度
- 順位: 01 / 5候補
- RICEスコア: 640 (Reach=800 / Impact=2 / Confidence=0.8 / Effort=2.0人週)
- 根拠: M1/M3の入力になる土台。スコアも首位。依存より先に置く
- 依存: なし。M1/M3がこのPBIに依存する

## 背景・制約
- `historyQueryCache` と `sqliteHistoryModel`(`src/dashboard/panels/asyncData/`)を流用し、足りない永続化と共有UIだけを足す
- 3バックエンド対応の重さ(OPFS/IDB/Fallback、FTS/LIKE分岐)を本PBIで一度だけ払い、M1/M3では回収する。フォールバック縮退の表示を含む
- `DASHBOARD_MUTABLE_SUBSET`・`EXPORT_COLUMNS` 固定と干渉させない。列追加は互換方針の見直しとセットにする
- i18n(ja/en)・a11y(WCAG 2.1 AA)・validate緑を維持する

## BDD受け入れシナリオ
Scenario: コレクションを保存して再利用する
  Given 検索条件(語・タグ・期間)を指定した
  When 名前付きで保存した
  Then 一覧から呼び出せ、件数と更新時刻が分かる

Scenario: 自動タグ規則が適用される
  Given 自動タグ規則(条件→タグ)を登録した
  When 新規記録が保存された
  Then 条件に合う記録にタグが付き、誤適用は取り消せる

## 受け入れ基準
- [ ] コレクションの作成・改名・複製・削除ができる
- [ ] 自動タグ規則の適用・取消・優先順位がある
- [ ] フォールバック環境でも一覧と適用ができる(縮退表示付き)
- [ ] M1/M3からコレクションを入力に選べる

## テスト戦略
## 実装記録（2026-10-23・再開点のみ・未着手）
- 流用先（PBI自体の指示どおり）: `src/dashboard/panels/asyncData/` の `historyQueryCache` と `sqliteHistoryModel` を流用し、足りない永続化（保存済み検索条件の名前付き保持）と共有UIだけを足すのが本PBIの範囲。3バックエンド対応(OPFS/IDB/Fallback・FTS/LIKE分岐)の重さを本PBIで一度だけ払う
- 再開点: (1) asyncData の既存モジュール構成を確認 (`historyQueryCache`・`sqliteHistoryModel` の受け口) (2) 保存済み条件の設定キー (`SAVED_COLLECTIONS` 等) と StrictSettings エントリ (3) 共有UIの配置 (dashboard panels) (4) M1/M3 からの入力選択経路
- 設定キー: 完了（commit 958f31c5）。`SAVED_COLLECTIONS: 'saved_collections'` を追加し、DEFAULT_SETTINGS に空マップで既定値保持。残は保存UI・共有経路・M1/M3入力選択- E2E: 保存→呼び出し→自動タグ→M3入力の通し
- 統合: FTS/LIKE両パスの条件再現テスト、規則競合の優先テスト
- 単体: 条件シリアライズ・規則判定のテーブルテスト

## 見積もり
2.0人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(コレクション操作手順を含む)
