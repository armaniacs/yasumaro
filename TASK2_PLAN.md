# Task 2: 属性スキャン拡張 実装計画

## 目的
現在の `stripKeywordElements` と `countCleanseTargets` は id 属性と class 属性のみをスキャン対象としている。
これを拡張し、`data-*` 属性で始まるすべてのカスタムデータ属性もスキャン対象に追加する。

## 実装ステップ

### 1. stripKeywordElements 関数修正 (src/utils/contentCleaner.ts:156-176)
- 現在: id 属性と class 属性のみをスキャン
- 変更後: id, class, および `data-*` 属性すべてをスキャン

### 2. countCleanseTargets 関数修正 (src/utils/contentCleaner.ts:254-276)
- 同様に id, class, `data-*` 属性すべてをカウント対象に追加

### 3. テストケース追加
- data-* 属性にキーワードが含まれる要素が正しく削除されることを確認
- 既存テストが影響を受けないことを確認

### 4. テスト実行
- すべてのテストがパスすることを確認

### 5. コミット
- 変更をコミット

## 対象ファイル
- 修正: `src/utils/contentCleaner.ts`
- テスト: `src/utils/__tests__/contentCleaner.test.ts`

## 後方互換性
- 既存の動作は維持したまま、新たに data-* 属性を追加する
- 既存のキーワードリストはそのまま使用可能
