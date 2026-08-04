# PBI: テストの型安全化（@ts-expect-error を vi.mocked 化する）

**作成日**: 2026-08-04
**優先度**: 低（次リリース以降でよい）
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（テストコードのみの変更、挙動不変）
**種別**: refactor（レビュー指摘: DX Advocate [Low]）

---

## 背景（5 Whys 分析）

Checking Team レビューの DX Advocate [Low]「テストに @ts-expect-error が2箇所散在」を起点とする。

### 5 Whys

- **Why 1**: なぜ `@ts-expect-error` を使うのか？
  → `vi.fn()` の型絞り込み（ReturnType<typeof vi.fn>）がモックオブジェクトの実際の型と一致せず、TS がエラーを出すため。
- **Why 2**: なぜ型エラーが発生するのか？
  → `storage.getSettings` を `vi.fn()` でモックし、`mockResolvedValue` を呼ぶ際に返り値の型が「設定オブジェクトの型」と一致しないため。
- **Why 3**: なぜ型安全な方法を使わないのか？
  → `vi.mocked()` や `ReturnType` の適切な型付けをせず、エラー抑制で回避したため。
- **Why 4**: なぜ抑制を選んだのか？
  → 手早く通すため。既存テストからコピーされたパターンが定着していた。
- **Why 5**: なぜ問題になるのか？
  → 基盤の型（`vi.fn` のシグネチャ、`getSettings` の型）が変わると、`@ts-expect-error` は「抑制が必要ないのに付与されている」と判定されコンパイルエラーになる。テストが過剰抑制で脆くなる。

### 根本原因
モックの型付けに型安全なヘルパー（`vi.mocked()`）を使わず、`@ts-expect-error` による抑制へ依存したため、型変化に対して脆弱なテストになった。

### 対処
`vi.mocked()` による型付きヘルパーへ置き換え、`@ts-expect-error` を撤廃する。

## 受け入れ基準（BDD）

```gherkin
Scenario: @ts-expect-error がテストから除去される
  Given aiClient-priority-fallback.test.ts の進捗コールバック describe
  When モックを型付きヘルパーに置換する
  Then @ts-expect-error が存在せず、type-check が通る
```

## 受け入れ基準
- [ ] `src/background/__tests__/aiClient-priority-fallback.test.ts` の `@ts-expect-error` が `vi.mocked()` 化で撤廃される
- [ ] `npm run type-check` が通る
- [ ] テストの意味（検証内容）は不変

## テスト戦略
- type-check と該当テストの実行で確認

## 実装アプローチ
- `const mockGetSettings = vi.mocked(storage.getSettings);` に統一 → `@ts-expect-error` 除去 → type-check

## Definition of Done
- [ ] `@ts-expect-error` が撤廃され type-check が通る
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- レポート: `plans/2026-08-04-1950-review-v6.7.12-ai-test-progress.md`（DX Advocate Low）
- 対象コード: `src/background/__tests__/aiClient-priority-fallback.test.ts`
