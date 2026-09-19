# PBI: cleansingOffscreen のサイズ上限とフォールバック廃止

## ユーザーストーリー
拡張機能利用者として、巨大なHTMLを処理してもOffscreenが応答不能にならないでほしい、なぜならAI要約クレンジング中に拡張全体が固まると閲覧記録が失われるから

## 優先度
- 順位: 01 / 13
- RICEスコア: 80（Reach=100 / Impact=2 / Confidence=80% / Effort=2）
- 根拠: 唯一の High 指摘。DoS/XSS 波及の実害があり、単独でリリース可能な縦スライス

## ビジネス価値
Offscreen 応答不能による記録損失を防止する。巨大ページでのクレンジング失敗率を測定し、拒否率の可視化で改善を追跡できる

## BDD受け入れシナリオ

```gherkin
Scenario: 上限超過のHTMLは拒否される
  Given クレンジング対象のHTMLが512KBを超えている
  When handleCleansingOffscreenPayload に渡す
  Then success:false と上限超過エラーが返る
  And Offscreen は応答可能なままである

Scenario: 上限以内のHTMLは正常にクレンジングされる
  Given 512KB以内の通常のHTML
  When handleCleansingOffscreenPayload に渡す
  Then success:true とクレンジング済みHTMLが返る
```

## 受け入れ基準
- [x] 512KB超過の payload が success:false で拒否される
- [x] 上限以内の正常系が従来通り success:true を返す
- [x] フォールバック経路（container.innerHTML 直書き）が隔離 document（createHTMLDocument）に置換されている
- [x] 拒否時に呼び出し側が縮退動作する（cleanseViaOffscreen が cleanseHtmlSync にフォールバック済み）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 巨大ページでの記録フローが固まらず完了する

### 統合テスト
- handleCleansingOffscreenPayload の上限境界テスト（512KB±1byte）
- 呼び出し側の縮退動作テスト

### 単体テスト
- cleanseHtmlOffscreen のサイズ検証ロジック
- エラーメッセージの内容検証

## 実装アプローチ
- **Outside-In**: 拒否シナリオのE2Eから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（単一ファイル＋呼び出し側の縮退対応のみ）
- テスタビリティ: payload サイズの境界値テストが容易
- 非機能要件: 上限値は定数化し、将来の調整を可能にする

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "cleanseHtmlOffscreen\|handleCleansingOffscreenPayload" src/
```

### 実装手順
1. 拒否シナリオのテストを先に書く（上限超過で success:false）
2. handleCleansingOffscreenPayload にサイズ検証を追加する
3. フォールバック経路を DOMParser 必須化または削除する
4. 呼び出し側の縮退動作を確認する

### 落とし穴
- 上限値はマジックナンバーにせず名前付き定数にすること
- jsdom/node 環境のフォールバック削除時はテスト環境の DOM 可用性を確認すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（cleansingOffscreen.test.ts 境界2件＋delegate 経路統合テスト）
- [x] テストカバレッジが基準を満たす（単体＋統合。E2E は委譲経路の統合テストで代替）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み（コードコメントが正本。文書要件なし）
