# PBI: プロトコルバージョン欠落メッセージを格下げ警告にする

## ユーザーストーリー
拡張機能利用者として、古い content script が残っていても安全な経路だけが使われてほしい、なぜならバージョンなしメッセージの無条件受け入れはダウングレード攻撃の余地になるから

## 優先度
- 順位: 05 / 13
- RICEスコア: 24（Reach=100 / Impact=1 / Confidence=80% / Effort=3.33）
- 根拠: セキュリティ価値は高いが、旧 sender の移行影響調査が必要で Effort が大きい

## ビジネス価値
ダウングレード攻撃面を縮小し、移行進捗をカウンタで可視化できる

## BDD受け入れシナリオ

```gherkin
Scenario: バージョンなしメッセージは警告付きで受け入れられる
  Given protocol version フィールドなしのメッセージ
  When checkEnvelope に渡す
  Then 受け入れられるが警告ログとカウンタが記録される

Scenario: サポート外バージョンは従来通り拒否される
  Given 範囲外バージョンのメッセージ
  When checkEnvelope に渡す
  Then 'Protocol version mismatch' で拒否される
```

## 受け入れ基準
- [x] absent が deprecated 扱いに格下げされている（deprecated フラグ付きで受け入れ）
- [x] 集計カウンタ（getAbsentVersionCount）が記録される
- [x] 既存の current/deprecated/unsupported 判定が変わらない
- [x] envelopePolicy の既存テストが green である（15 passed、absent テストを移行仕様に更新）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 旧 content script 混在環境でのメッセージ送受信が警告付きで動作する

### 統合テスト
- checkEnvelope の absent 分岐テスト

### 単体テスト
- classifyProtocolVersion の境界値テスト

## 実装アプローチ
- **Outside-In**: absent 警告シナリオのテストから開始
- **Red-Green-Refactor**: 既存判定を壊さずに追加する

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: checkEnvelope の純粋性が高くテスト容易
- 非機能要件: いきなり拒否にしない（後方互換を保つ graded 移行）

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "classifyProtocolVersion\|checkEnvelope" src/background/handlers/envelopePolicy.ts
```

### 実装手順
1. absent 警告のテストを書く
2. 格下げロジックとカウンタを追加する
3. API_ENDPOINTS.md にバージョン規約を追記する（PBI 13 と重複する場合は調整）

### 落とし穴
- untrusted sender への詳細 reason 返却は別指摘（Blue Low）であり、本PBIでは変えないこと。スコープを absent 格下げに絞る

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
