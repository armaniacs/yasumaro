# PBI: Content Extractor のグローバル可変状態を CleansingConfig に集約

元指摘: Checking Team (Medium: Maintainability Guardian)

## ユーザーストーリー
開発チームとして、`src/content/extractor.ts` の25個以上のモジュールレベル `let` 変数と、200行にわたる同一パターンの if ブロックを `CleansingConfig` インターフェースに集約したい、なぜなら現在は新しいクレンジングオプションを追加するたびに (1) let 変数追加、(2) loadSettings に if ブロック追加、(3) extractPageContent のオプションオブジェクトにプロパティ追加の3箇所を変更する必要があり、拡張性とテスタビリティを損なっているから

## ビジネス価値
- 新しいクレンジングオプション追加時の変更箇所を3箇所→1箇所に削減
- 設定値の一括管理による変更漏れ防止
- 単体テストの容易化（設定オブジェクトの注入が可能に）

## BDD受け入れシナリオ

```gherkin
Feature: コンテンツ抽出設定の集約

  Scenario: 全クレンジングオプションが CleansingConfig で管理される
    Given extractor.ts に25個以上の個別設定が存在する
    When CleansingConfig インターフェースに集約する
    Then 個別の let 変数が削除される
    And loadSettings 内の if ブロックがループ処理に置き換わる

  Scenario: 新しいクレンジングオプション追加が1箇所で済む
    Given CleansingConfig に新しいプロパティを追加する
    When loadSettings が自動的にループ処理で読み込む
    Then extractPageContent が新しい設定を正しく参照する
    And 既存の挙動が変わらない
```

## 受け入れ基準
- [ ] `CleansingConfig` インターフェースを定義（全クレンジングオプション + AI要約設定を包含）
- [ ] 25+のモジュールレベル `let` 変数を削除し、単一の設定オブジェクトに置換
- [ ] `loadSettings` の if ブロック連鎖をループ処理（設定キー配列を回す）に置換
- [ ] `extractPageContent` が `CleansingConfig` オブジェクトを受け取る形に変更
- [ ] 既存のextractorテストがすべてパスする（回帰なし）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 統合テスト
- 既存の extractor テストが設定集約後も同じ結果を返すことを確認

### 単体テスト
- `CleansingConfig` のデフォルト値マージテスト
- ループ処理での設定読み込みが正しいキー・型で動作するテスト

## 実装アプローチ
- **Safe Refactor**: まず `CleansingConfig` インターフェースを定義。次に既存の let 変数を設定オブジェクトのプロパティに1つずつ置換（各ステップでテストがパスすることを確認）。最後に loadSettings のループ化。
- 変更は extractor.ts に閉じており、外部モジュールへの影響はない。

## 見積もり
3pt（インターフェース定義 + 変数置換 + loadSettings ループ化 + テスト確認）

## 技術的考慮事項
- `src/content/extractor.ts` は Content Script として動作するため、バンドルサイズへの影響に注意。CleansingConfig は型のみまたは軽量なランタイムオブジェクトとする
- extractor.ts は ESM の制約がある（loader.ts が静的に import しない）。ただし設定値の集約は純粋なリファクタリングであり、バンドルに影響しない

## 落とし穴
- 25個の変数を一気に置換するとデグレのリスクが高い。1〜2個ずつ置換してテストを都度パスさせる段階的アプローチを推奨
- `extractPageContent` の引数が変わるため、この関数を直接呼び出しているテストコードの更新が必要

## Definition of Done
- [ ] CleansingConfig インターフェースが定義されている
- [ ] モジュールレベル let 変数が削除され設定オブジェクトに置換されている
- [ ] loadSettings がループ処理になっている
- [ ] extractPageContent の引数が CleansingConfig を受け取る形に変更されている
- [ ] 既存テストがすべてパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
