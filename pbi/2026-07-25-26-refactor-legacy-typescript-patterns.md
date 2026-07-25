# PBI: obsidianClient.ts / settingsStore.ts のRecord<string, unknown>キャストを型安全なヘルパーに置き換える

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（型定義の変更のみだが、周辺コードの型エラーが連鎖的に顕在化する可能性がある）

---

## 背景

Checking Team レビュー（2026-07-25）の Refactoring Evangelist からの指摘。`src/background/obsidianClient.ts:82` および `src/utils/storage/settingsStore.ts:129` に `settings as Record<string, unknown>` および `s[key]` 形式の動的アクセスが存在する。型安全性を損ない、リファクタリング時にコンパイラによる追跡ができない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "as Record<string, unknown>\|\[key\]" src/background/obsidianClient.ts src/utils/storage/settingsStore.ts
grep -n "StorageKeys" src/utils/storage.ts | head -5
```

`StorageKeys` enum の定義を確認し、`Record<StorageKeys, unknown>` 型でキャストするだけで十分か、専用のヘルパー関数（getter/setter）が必要かを判断する。

## 受け入れ基準（BDD）

```gherkin
Scenario: settingsStoreへのアクセスが型安全になる
  Given settingsStore.ts で Record<StorageKeys, unknown> 型のヘルパー関数が定義されている
  When 開発者が存在しないキーでアクセスしようとする
  Then TypeScriptのコンパイルエラーで検出される

Scenario: obsidianClient.tsの動的アクセスが型安全になる
  Given obsidianClient.ts:82 の Record<string, unknown> キャストがヘルパー関数に置き換えられている
  When 型チェックを実行する
  Then 既存の any/unknown アクセスに起因する型エラーが解消される

Scenario: 既存の挙動が変わらない
  Given リファクタリング後のコード
  When 既存のユニットテストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `src/utils/storage/settingsStore.ts:129` 付近の `s[key]` パターンを `Record<StorageKeys, unknown>` を用いたkvストアアクセスヘルパー関数に置き換える
- [ ] `src/background/obsidianClient.ts:82` の `settings as Record<string, unknown>` を同様のヘルパー経由に置き換える
- [ ] `npm run type-check` でエラーが出ないことを確認する
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- 既存の `settingsStore` / `obsidianClient` テストが回帰しないことを確認
- 型レベルのテスト（コンパイル時検証）は `npm run type-check` で担保

## 実装アプローチ

1. `StorageKeys` を使った型安全なアクセスヘルパー（例: `getSettingValue<K extends StorageKeys>(settings, key: K)`）を設計
2. `settingsStore.ts` の該当箇所を置き換え
3. `obsidianClient.ts` の該当箇所を置き換え
4. `npm run type-check` で全体の型エラーを確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/utils/storage.ts` の `StorageKeys` enum
- テスタビリティ: 既存テストで担保、型チェックはCIの `type-check` ステップで担保

## Definition of Done
- [ ] 対象箇所が型安全なヘルパー経由に置き換えられている
- [ ] `npm run type-check` がパスする
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Refactoring Evangelist指摘）
- 対象コード: `src/background/obsidianClient.ts:82`, `src/utils/storage/settingsStore.ts:129`
