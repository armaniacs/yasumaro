# PBI: Offscreen Transport の選択結果を診断に記録する

## ユーザーストーリー
開発者として、障害時にどちらの Transport が選ばれたか診断で確認したい、なぜならChrome／InPage の二重実装は切り分けが困難だから

## 優先度
- 順位: 13 / 13
- RICEスコア: 8（Reach=5 / Impact=1 / Confidence=80% / Effort=0.5）
- 根拠: 診断性向上のみで直接価値は小さいが工数も極小。Firefox 対応時の切り分けに効く

## ビジネス価値
OPFS/IDB 経路の不具合切り分け時間の短縮

## BDD受け入れシナリオ

```gherkin
Scenario: 起動時に選択結果が記録される
  Given バックグラウンド起動
  When Transport が選択される
  Then 起動ログに transport 名が記録される
  And 診断出力に transport 名が含まれる

Scenario: Firefox/InPage 経路でも記録される
  Given Firefox 環境または InPage 経路
  When 起動する
  Then 対応する transport 名が記録される
```

## 受け入れ基準
- [x] transport 選択結果が起動ログに記録される（OffscreenGateway.getTransport で getOffscreenTransportName を logInfo）
- [x] 診断出力に transport 名（in-page／chrome-offscreen）が含まれる
- [x] type-check が green である（選択はビルド時定数のため両経路の分岐は既存通り）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要

### 統合テスト
- 各経路での選択・記録テスト

### 単体テスト
- 選択ロジックの分岐テスト

## 実装アプローチ
- **Outside-In**: 記録の統合テストから開始
- **Red-Green-Refactor**: ログ追加のみの小変更

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 選択関数のモックで検証可能
- 非機能要件: ログ量の増加は最小限に

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "Transport" src/background/createBackgroundServices.ts src/background/ChromeOffscreenTransport.ts src/background/InPageOffscreenTransport.ts | head -20
```

### 実装手順
1. 記録のテストを書く
2. 選択結果のログ記録を追加する
3. 診断出力に含める

### 落とし穴
- 個人情報をログに出さないこと。transport 名のみ

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
