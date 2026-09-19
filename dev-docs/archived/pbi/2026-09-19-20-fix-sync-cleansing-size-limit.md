# PBI: メインスレッド同期クレンジングにもサイズ上限を設ける

## ユーザーストーリー
拡張機能利用者として、feature flag が無効な環境でも巨大ページで固まらないでほしい、なぜなら Offscreen 経路だけ守っても、同期直接パース経路が素通しでは保護が不均一になるから

## 優先度
- 順位: 07 / 7
- RICEスコア: 8（Reach=5 / Impact=1 / Confidence=80% / Effort=0.5）
- 根拠: 対象は flag 無効環境のみで絞られる。PBI 14 の兄弟要件として低優先に配置

## ビジネス価値
クレンジング経路全体が同一のサイズ契約に従う。測定は同期パース拒否件数

## BDD受け入れシナリオ

```gherkin
Scenario: 同期パースも上限を守る
  Given cleansing_offscreen_enabled が false の環境
  When 512KB超の html で cleanseHtmlSync を呼ぶ
  Then 上限拒否の挙動が Offscreen 経路と一致する
  And 巨大な DOM パースが走らない

Scenario: 上限以内は従来通り動く
  Given 同じ環境
  When 512KB以下の html で cleanseHtmlSync を呼ぶ
  Then 従来通りのクレンジング結果が返る
```

## 受け入れ基準
- [x] cleanseHtmlSync にサイズ検証が追加されている（MAX_CLEANSING_HTML_BYTES 再利用）
- [x] 拒否時の挙動が PBI 14 と一貫する（元 html 返却）
- [x] flag 有効環境の既存テストが green である（14 passed）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- flag 無効環境での記録フロー

### 統合テスト
- 同期経路の上限境界テスト

### 単体テスト
- 上限値の境界（512KB±1）

## 実装アプローチ
- **Outside-In**: 境界テストから開始
- **Red-Green-Refactor**: 共通定数の再利用

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 14（2026-09-19-14）と挙動を揃えること
- テスタビリティ: MAX_CLEANSING_HTML_BYTES を再利用
- 非機能要件: content script でのメモリ消費に注意

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "cleanseHtmlSync" src/content/cleansingOffscreenDelegate.ts
grep -n "MAX_CLEANSING_HTML_BYTES" src/offscreen/cleansingOffscreen.ts
```

### 実装手順
1. 境界テストを書く
2. cleanseHtmlSync に検証を追加する
3. 拒否挙動を PBI 14 と一致させる

### 落とし穴
- content script bundle が offscreen モジュールに依存しないよう、定数の配置場所を検討すること
- flag 無効環境のテストが現状少ない可能性がある。テスト追加を忘れないこと

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
