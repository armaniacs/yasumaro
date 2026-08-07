# PBI: レガシーurlStorage.tsをsavedUrlStore.tsに統合して削除する

**作成日**: 2026-08-07
**優先度**: 中
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（内部モジュール統合。外部API・UIへの影響なし）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで `utils/urlStorage.ts`（245行）と `utils/storage/savedUrlStore.ts`（276行）が同一のsaved-URL APIを実装していることが発見された。

### 重複の詳細

両方とも同じストレージキー（`savedUrls`, `savedUrlsWithTimestamps`）に対して同一APIを提供:

| 関数 | 一致度 |
|------|--------|
| `getSavedUrls()` | Verbatim |
| `getSavedUrlsWithTimestamps()` | Verbatim |
| `setSavedUrls()` | 構造同一 |
| `addSavedUrl()` | 構造同一 |
| `removeSavedUrl()` | 構造同一 |
| `isUrlSaved()` | 構造同一 |
| `getSavedUrlCount()` | 構造同一 |

### 差異

- `savedUrlStore.ts` はクォータチェック（`getStorageUsage`）とレガシークリーンアップ機能を追加
- `urlStorage.ts` は `withOptimisticLock` を直接使用
- `urlStorage.ts` は独自の `urlEntry.ts` から `SavedUrlEntry` 型をインポート

### 依存関係

```
urlStorage.ts ← storageUrls.ts（唯一のレガシー側import元）
urlStorage.ts ← __tests__/urlStorage.test.ts（テスト）

savedUrlStore.ts ← storage.ts（再エクスポート経由）
savedUrlStore.ts ← その他多数のモジュール
```

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "from.*urlStorage" src/ --include="*.ts" | grep -v __tests__
grep -rn "from.*savedUrlStore" src/ --include="*.ts" | grep -v __tests__
wc -l src/utils/urlStorage.ts src/utils/storage/savedUrlStore.ts
```

## 受け入れ基準（BDD）

```gherkin
Scenario: urlStorage.tsが削除され、savedUrlStore.tsが単一ソースになる
  Given src/utils/urlStorage.tsが存在しない状態
  When storageUrls.tsがsaved-URL操作を必要とする
  Then src/utils/storage/savedUrlStore.tsからインポートできる

Scenario: 既存のurlStorageテストがsavedUrlStoreに移植される
  Given src/utils/__tests__/urlStorage.test.ts
  When テストを実行する
  Then savedUrlStore.tsに対して全てパスする

Scenario: バックワード互換性が維持される
  Given storage.tsの再エクスポート層
  When 外部モジュールが `from '../utils/storage.js'` でインポートする
  Then savedUrlStoreの関数が利用可能
```

## 受け入れ基準
- [ ] `storageUrls.ts` のインポートを `urlStorage.js` → `storage/savedUrlStore.js` に切り替え
- [ ] `urlStorage.ts` を削除
- [ ] `urlStorage.test.ts` を `savedUrlStore.test.ts` にリネームし、savedUrlStoreをインポートするように書き換え
- [ ] `storage.ts` の再エクスポートに `urlStorage` からのインポートが含まれていないことを確認
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- 既存の `urlStorage.test.ts` をリネームして維持
- `savedUrlStore.ts` の追加機能（クォータチェック、レガシークリーンアップ）のテストがパスすることを確認

### 回帰テスト
- `storageUrls.ts` を使用する全モジュールの動作確認

## 実装アプローチ
- インポート切り替え → レガシーファイル削除 → テストリネームの3ステップ
- 段階的: まず `storageUrls.ts` のインポートを切り替え → テスト実行 → ファイル削除

## 見積もり
1pt（インポート切り替え + ファイル削除 + テスト更新）

## 技術的考慮事項
- `urlStorage.ts` は `urlEntry.ts` から型をインポート。`savedUrlStore.ts` は独自に `SavedUrlEntry` 型を定義。統合後は `urlEntry.ts` の利用状況を確認
- `storage.ts` の再エクスポートが正しく動作することを確認（既に `savedUrlStore.ts` を再エクスポートしている）
- `urlStorage.ts` の `MAX_CONTENT_ENTRIES` は `urlEntry.ts` からインポート。`savedUrlStore.ts` にはこの定数がないため、必要に応じて追加

## 関連
- コードレビューレポート: 本セッションの重複レビュー（Cluster 8）
- 対象ファイル: `src/utils/urlStorage.ts`, `src/utils/storage/savedUrlStore.ts`, `src/utils/storageUrls.ts`, `src/utils/__tests__/urlStorage.test.ts`
