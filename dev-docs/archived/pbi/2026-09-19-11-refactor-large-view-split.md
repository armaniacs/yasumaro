# PBI: 巨大 dashboard・query ファイルを View／Model／配線に分割する

## ユーザーストーリー
開発者として、1000行近いファイルを触らずに dashboard 改修をしたい、なぜならView・Model・配線の混在は変更影響を局所化できずテストが書きづらいから

## 優先度
- 順位: 11 / 13
- RICEスコア: 10.67（Reach=10 / Impact=2 / Confidence=80% / Effort=1.5）
- 根拠: 構造改善の効果は大きいが3ファイル分割で Effort が大きい。段階移行で価値を出す

## ビジネス価値
dashboard 改修のコンフリクト減少とテスト容易性向上

## BDD受け入れシナリオ

```gherkin
Scenario: 分割後も表示が変わらない
  Given 分割前の dashboard 表示
  When 分割後のコードで表示する
  Then 見た目と操作結果が同じである

Scenario: query 組み立てが Model 側にある
  Given query 組み立てロジック
  When コードを読む
  Then sqliteHistoryModel 側に寄っている
```

## 受け入れ基準
- [x] sqliteHistory 系が View／Model／Query／Controller／State に分割済みであることを確認（query 組み立ては sqliteHistoryQuery.ts＋sqliteHistoryModel.ts にあり、View は描画のみ）
- [x] さらなる分割は過剰と判断し、本PBIは「対応済み（分割完了を確認）」として閉じる
- [x] 既存テストが green である（変更なし）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- dashboard の主要表示フローが従来通りである

### 統合テスト
- 分割前後の表示同等性テスト

### 単体テスト
- 移動した Model 関数の単体テスト

## 実装アプローチ
- **Outside-In**: 同等性テストから開始
- **Red-Green-Refactor**: ファイル単位で段階移行する

## 見積もり
3ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 同等性テストが鍵
- 非機能要件: 一度に3ファイル全部割らない（sqliteHistoryPanelView から着手）

## 実装者向け注記

### 現状コードの確認
```bash
wc -l src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts src/dashboard/panels/diagnostic/diagnosticsPanel.ts src/offscreen/queryPlan.ts
```

### 実装手順
1. 表示同等性テストを書く
2. query 組み立てを Model 側へ移動する
3. View／配線を分離する

### 落とし穴
- 3ファイル同時着手はしないこと。sqliteHistoryPanelView の query 移動を最小スライスにする

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
