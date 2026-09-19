# PBI: popup innerHTML 連鎖に静的検査と clearElement を導入する

## ユーザーストーリー
開発者として、popup の描画追加時にエスケープ漏れが自動で検出されてほしい、なぜなら1か所の漏れで stored XSS になる単一障害点を人手では防ぎきれないから

## 優先度
- 順位: 04 / 13
- RICEスコア: 30（Reach=100 / Impact=1 / Confidence=80% / Effort=2.67）
- 根拠: PBI 03 の一本化が前提。CI 検査＋ヘルパー導入で将来の漏れを止める予防策

## ビジネス価値
将来の XSS 混入を CI で検出できる。innerHTML クリア直書きの散在も解消される

## BDD受け入れシナリオ

```gherkin
Scenario: esc なしの innerHTML 追加はCIで検出される
  Given esc なしで innerHTML に代入するコード
  When CI を実行する
  Then 検査が失敗し指摘される

Scenario: クリア処理はヘルパーに統一される
  Given 既存の container.innerHTML = '' の箇所
  When clearElement に置き換える
  Then 表示挙動が変わらない
```

## 受け入れ基準
- [x] esc 適用の静的検査（scripts/check-innerhtml-escape.mjs＋npm run check-innerhtml-escape）が導入されている
- [x] domUtils.ts に clearElement(el) が追加されている
- [x] recordSession.ts:265・trancoNotification.ts:55・pendingPages.ts:29 が clearElement に置換されている
- [x] type-check が green、ガードスクリプトが OK である

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- popup の各ステータス表示が従来通り描画される

### 統合テスト
- CI 検査が esc 漏れサンプルを検出する

### 単体テスト
- clearElement の動作（子要素削除・null 耐性）

## 実装アプローチ
- **Outside-In**: 検出テストから開始
- **Red-Green-Refactor**: 段階的に置換する

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 03（htmlEscape 一本化）に依存
- テスタビリティ: 検査スクリプトの true/false テストが容易
- 非機能要件: textContent ベースへの全面移行は本PBIの範囲外（段階移行の第一歩）

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "innerHTML" src/popup/ src/privacy/
```

### 実装手順
1. esc 漏れ検出の検査スクリプトを書く
2. clearElement を追加し3か所を置換する
3. CI に検査を組み込む

### 落とし穴
- render*Html 関数は正規の描画経路であり、検査の除外リストに入れること。検査対象は「esc なしの生文字列代入」のみ

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
