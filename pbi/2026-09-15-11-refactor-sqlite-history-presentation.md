# PBI: sqliteHistory presentation 抽出 — View と Model の二重所有解消

## ステータス: ⬜ 未着手（順位3 / RICE 4.0 / 台帳: 2026-09-15-00-backlog-archloop-0915.md 候補10）

## ユーザーストーリー

メンテナとして、削減率の定義や FTS 判定のような表示ドメイン判断が1箇所の純粋関数に集約されていてほしい。なぜなら現在 View（sqliteHistoryPanelView.ts、全src最大の925行）と Model（sqliteHistoryModel.ts、776行）が削減率の定義を二重所有し、定義変更時に2ファイルの同期編集が必要だから。

## 優先度

- 順位: 3 / 本バッチ4件中
- RICEスコア: 4.0（Reach=4 / Impact=1 / Confidence=50% / Effort=0.5人週）
- 根拠: 値は小さいが Model/View 分離の品質に直結。Confidence 50% は 925行 View 内の残留箇所の特定に手間がかかるため

## 背景（診断結果）

- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:33-50,74-78,80-155` — View にドメイン判定（削減率 fallback 連鎖・FTS 判定）が残留
- `sqliteHistoryModel.ts:256-276,336-366` — Model 側にも類似判定があり二重所有
- Model の sort 永続化が chrome.storage を直結（deps 注入の非対称）

## 実装ガイド

1. **`historyEntryPresentation.ts`（純粋関数）を新設**:
   - 削減率計算（fallback 連鎖含む）を1関数に
   - FTS 判定（モデル由来か LIKE 由来か）を1関数に
2. **View と Model が両方その純粋関数を呼ぶ**（二重所有の解消）
3. **Model の sort 永続化を deps 注入に**: chrome.storage 直結を adapter 経由に（queryPlan 等と同じ deps パターン）

### 触ってはいけないもの

- sqliteHistoryModel のページング・クエリロジック（本 PBI は表示ドメイン判断のみ）
- e2e の検索・履歴表示の契約

## BDD受け入れシナリオ

```gherkin
Scenario: 削減率の定義変更が1関数で完結する
  Given historyEntryPresentation.ts に削減率計算が集約されている
  When  削減率の定義（丸め・fallback）を変更する
  Then  View と Model の両方に同一の変更が反映される（二重所有の解消を単体テストで pin）
```

## 受け入れ基準

- [ ] 削減率計算と FTS 判定が純粋関数 module に集約されている
- [ ] View と Model が同一の純粋関数を呼んでいる（二重所有の解消をテストで pin）
- [ ] Model の sort 永続化が deps 注入経由になっている
- [ ] sqliteHistoryPanel 関連テスト全件 green

## テスト戦略

- 単体: 純粋関数の境界（0件・null・fallback 連鎖）
- 既存: sqliteHistoryPanel-pending / tagFallback テストが回帰網

## 見積もり

2-3日

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（純粋関数 module 先頭コメント）
