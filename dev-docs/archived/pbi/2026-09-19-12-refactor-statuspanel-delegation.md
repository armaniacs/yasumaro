# PBI: statusPanel の描画を statusRenderers へ完全移譲する

## ユーザーストーリー
開発者として、新規ステータス追加時に触る場所が render 側だけであってほしい、なぜなら調停と描画の同居は変更点を分散させるから

## 優先度
- 順位: 12 / 13
- RICEスコア: 9.6（Reach=10 / Impact=1 / Confidence=80% / Effort=0.83）
- 根拠: UI 構造改善。popup 描画の責務明確化で将来の改修が楽になる

## ビジネス価値
新規ステータス追加のリードタイム短縮

## BDD受け入れシナリオ

```gherkin
Scenario: 移譲後も各ステータスが正しく描画される
  Given cleansing・trust・domain・privacy・cache の各状態
  When statusPanel で表示する
  Then 従来と同じ描画になる

Scenario: statusPanel は調停のみになる
  Given statusPanel.ts のコード
  When 読む
  Then 種別ごとの render 実装がなく委譲呼び出しのみである
```

## 受け入れ基準
- [x] 種別ごとの render が statusRenderers.ts にあることを確認（8関数が移譲済み）
- [x] statusPanel.ts は調停＋DOM反映のみであることを確認（430行中 render 実装なし）
- [x] 本PBIは「対応済み（移譲完了を確認）」として閉じる（変更なし）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- popup の各ステータス表示フローが従来通りである

### 統合テスト
- 各 render の委譲経路テスト

### 単体テスト
- 各 render 関数の入出力テスト

## 実装アプローチ
- **Outside-In**: 同等性テストから開始
- **Red-Green-Refactor**: 種別単位で段階移譲する

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 04 と連携するが独立実行可能
- テスタビリティ: 同等性テストが鍵
- 非機能要件: 描画結果の変更なし

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "render.*Html\|innerHTML" src/popup/statusPanel.ts | head -20; ls src/popup/statusRenderers.ts
```

### 実装手順
1. 描画同等性テストを書く
2. 種別ごとに render を移譲する
3. statusPanel を調停のみにする

### 落とし穴
- PBI 04 の clearElement 置換と競合しないよう、同一箇所の同時編集に注意すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
