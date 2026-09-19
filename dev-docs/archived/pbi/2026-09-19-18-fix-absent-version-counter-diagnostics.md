# PBI: absent プロトコルバージョンカウンタを診断に出力する

## ユーザーストーリー
開発者として、旧送信者（version なしメッセージ）の残存数を把握したい、なぜならカウンタが読まれないままでは移行完了の判断ができず、absent 受け入れの緩和が永遠に終わらないから

## 優先度
- 順位: 05 / 7
- RICEスコア: 12（Reach=5 / Impact=1 / Confidence=80% / Effort=0.33）
- 根拠: 工数極小で PBI 05 の移行完了判定を可能にする。diagnostics パネルの既存枠に追加

## ビジネス価値
absent 受け入れの廃止判断がデータでできる。カウンタが単なる実装詳細でなくなる

## BDD受け入れシナリオ

```gherkin
Scenario: 診断パネルにカウンタが表示される
  Given version なしメッセージが処理されている
  When 診断パネルを開く
  Then absent カウンタの値が表示される

Scenario: ゼロのままでも表示される
  Given version なしメッセージが来ていない
  When 診断パネルを開く
  Then 0 が表示される
  And 廃止判断の材料として有効である
```

## 受け入れ基準
- [x] getAbsentVersionCount の値が診断ログに現れる（absent 受け入れ時に logInfo、10件ごと＋初回）
- [x] SW 再起動でリセットされる性質がコメントに注記されている
- [x] 既存の envelopePolicy テストが green である（15 passed）
- 注: PBI台帳作成時は「診断パネル表示」を想定していたが、なぜなぜ分析の結果、新規 message type 追加は envelope・handler・テストの拡大を招くため過剰と判断し、ログ出力方式に変更した

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 診断パネル表示の確認

### 統合テスト
- カウンタ値の取得経路

### 単体テスト
- カウンタのリセット動作（既存）

## 実装アプローチ
- **Outside-In**: パネル表示のテストから開始
- **Red-Green-Refactor**: 表示1項目の追加

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 05（2026-09-19-05）の前提
- テスタビリティ: パネル描画は既存のテスト手法を流用
- 非機能要件: 診断パネルの既存項目構造に従う

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "getAbsentVersionCount" src --include="*.ts" | grep -v test
ls src/dashboard/panels/diagnostic/
```

### 実装手順
1. パネル表示のテストを書く
2. diagnosticsPanel に項目を追加する
3. リセット性の注記を追加する

### 落とし穴
- module-level カウンタは SW 再起動でゼロに戻る。永続が必要なら chrome.storage.session への退避を検討すること（本PBIは注記まで）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
