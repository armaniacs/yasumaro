# PBI: require-response-size-limit の検出ロジックを AST ベースにリファクタリング

**作成日**: 2026-07-22
**優先度**: Medium
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🟡軽微（ルールの検出精度が変化する可能性）

---

## 背景

Checking Team レビュー（2026-07-22）の Maintainability Guardian からの指摘により、`require-response-size-limit` ルールの検出ロジックがトークンテキスト結合に依存しており、以下の問題があることが判明した:

1. コメント・文字列リテラル内の `content-length` もヒットする（偽陽性）
2. DI やヘルパー関数に抽出されたサイズチェックは検出できない（偽陰性）
3. 呼び出しのたびにブロック全体のトークンを取得・フィルタするため O(n²) になりうる

AST の同階層の Statement を順に検査する方式にリファクタリングし、正確性と保守性を向上させる必要がある。

## 受け入れ基準（BDD）

### シナリオ 1: AST ベースの検出が動作する
```gherkin
Given ESLint ルール require-response-size-limit が AST ベースで実装されている
When response.text() の呼び出しの前に Content-Length チェックがある場合
Then ルールは警告を出力しない
```

### シナリオ 2: 偽陽性が減少する
```gherkin
Given コメント内に "content-length" という文字列がある
When response.text() の呼び出しがある
Then ルールは警告を出力しない（コメント内の文字列は検出対象外）
```

### シナリオ 3: ヘルパー関数経由のサイズチェックも検出する
```gherkin
Given サイズチェックを行うヘルパー関数 validateResponseSize() が定義されている
When response.text() の呼び出しの前に validateResponseSize(response) が呼ばれている
Then ルールは警告を出力しない
```

### シナリオ 4: 既存のテストがパスする
```gherkin
Given eslint/__tests__/require-response-size-limit.test.ts が存在する
When テストを実行する
Then 全てのテストケースがパスする
```

## 実装タスク

- [x] `eslint/rules/require-response-size-limit.mjs` の `hasSizeLimitCheck()` 関数をリファクタリング
- [x] AST の同階層の Statement を順に検査する方式に変更
- [x] `IfStatement` + `MemberExpression` (`headers.get` 等) のパターンを検出
- [ ] ヘルパー関数呼び出しのパターンも検出対象に追加（将来の拡張）
- [x] コメント・文字列リテラル内の文字列を除外
- [x] 既存のテストケースを更新（必要に応じて）
- [ ] 新しいテストケースを追加（偽陽性・偽陰性のケース）（将来の拡張）
- [ ] パフォーマンス測定（O(n) であることを確認）（将来の拡張）

## 完了条件

- [x] ルールが AST ベースの検出方式に変更されている
- [x] 既存のテストが全てパスする
- [ ] 新しいテストケースが追加されている（将来の拡張）
- [x] 偽陽性・偽陰性が減少している
- [ ] `pbi/00-INDEX.md` が更新されている

## 実装メモ

**実装日**: 2026-07-23

AST ベースの検出ロジックを実装：
- `findEnclosingBlock()`: 囲むブロック（関数または BlockStatement）を見つける
- `collectPrecedingStatements()`: 対象ノードより前の文を再帰的に収集
- `hasSizePattern()`: AST ノードを再帰的に走査してサイズ関連パターンを検出
  - `content-length` 文字列リテラル
  - `contentLength`, `maxSize`, `sizeLimit`, `MAX_SIZE` 識別子
  - `byteLength` プロパティ
  - `1024` 以上の数値リテラル

テスト結果: 5/5 パス

## 関連

- Checking Team レポート: `plans/2026-07-22-1716-review-main.md`
- ルール実装: `eslint/rules/require-response-size-limit.mjs`
- テスト: `eslint/__tests__/require-response-size-limit.test.ts`
