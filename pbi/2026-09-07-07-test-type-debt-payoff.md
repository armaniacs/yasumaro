# PBI: テスト型債務の全量返済（type-check:test を素 tsc ゲートに昇格）

## ユーザーストーリー

yasumaroの開発者として、テストコードに型チェックの生のゲートが効いてほしい。なぜなら、2026-09-07-04 で導入したベースラインゲートは「件数が増えない」ことしか保証せず、既存 2,601 件の型エラー（309 ファイル）は null 安全性・モック型付けの実害を隠し続けているから。

## 背景

2026-09-07-04（完了）の実測:
- testDir/tsconfig.json 修理（`vitest/globals` + rootDir）により、未型チェックだったテストの実在型エラーが顕在化
- 安全なコードモド（`vi.*` 型名前空間 325 件・不要 `@ts-expect-error` 265 件）を適用済み → **2,601 errors / 309 ファイル**
- 残りは null 安全性（TS2532/TS18047 ≈ 760）、モック型付け（TS2339 mock メソッド系 ≈ 240）、暗黙 any（TS7005/7006 ≈ 244）、引数不一致（TS2345 ≈ 304）など、1件ずつの判断が必要
- インベントリ: `testDir/type-check-baseline.json`（ファイル別件数）
- ゲート現状: `type-check:test` = ベースラッパー（増加検知のみ）。素の tsc は `type-check:test:raw` に残置

## ビジネス価値

- 型エラーの中には将来の実バグ（undefined アクセス・API 変更の追従漏れ）の予兆が含まれる
- `test:type-safe` が「型安全」を名乗るに値する状態になる

## BDD受け入れシナリオ

```gherkin
Scenario: 素の tsc ゲートが通る
  Given 全テストファイルの型エラーが 0 件である
  When npm run type-check:test:raw を実行する
  Then exit code 0 で終了する

Scenario: ベースラッパーが撤去される
  Given 素の tsc が常に exit 0 である
  When package.json の type-check:test を確認する
  Then type-check:test は tsc --project testDir/tsconfig.json --noEmit を直接実行する
  And testDir/type-check-baseline.json と scripts/check-type-baseline.mjs は削除されている
```

## 受け入れ基準

- [ ] `npm run type-check:test:raw` が exit 0（全型エラー解消）
- [ ] `type-check:test` を素の tsc に戻し、ベースラッパー・baseline.json を削除
- [ ] 修正中にテストの実行時挙動を変えない（型レベルのみ。vitest 実行は全グリーン維持）
- [ ] `npm run validate` が exit 0
- [ ] `test:type-safe` が exit 0

## テスト戦略

### 単体テスト
- なし（既存テストの期待値を変えない。型レベル修正のみ）

### E2Eテスト
- なし

## 実装アプローチ

1. `testDir/type-check-baseline.json` をインベントリに、エラー数の多いファイルから順に返済（上位: `main.test.ts` 196、`customPromptManager.test.ts` 152、`obsidianClient.test.ts` 104…）
2. ファイル単位で返済 → `type-check:test:raw` でそのファイルが 0 になるたびベースラインから削除（ベースラッパーが常時機能しているため回帰検知は維持される）
3. 返済パターンの目安:
   - TS2532/TS18047（null 安全性）: `?.` か `!` — テスト意図に合わせ選択（実装側のバグ発見なら PBI を立てて対処）
   - TS2339（mock メソッド）: `vi.mocked(x)` で包む
   - TS7005/7006（暗黙 any）: パラメータ型を付ける
   - TS2345/TS2322（不一致）: テスト意図に合わせモック or 期待値を修正
4. 0 件到達後、ラッパー撤去 + `type-check:test` を素 tsc に昇格

## 見積もり

8pt 以上（2,601 件・309 ファイル。要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-04 完了（ベースラインゲートが稼働中）
- **テスタビリティ**: 1ファイル返済のたび vitest run で挙動不変を確認（vitest --changed で差分実行可）
- **非機能要件**: 実行時挙動を変えないこと（型注釈・型アサーションのみ。`as` で誤魔化す場合は理由コメント必須）

## 実装者向け注記

### 現状コードの確認
```bash
cat testDir/type-check-baseline.json | head -20   # インベントリ
npm run type-check:test:raw 2>&1 | cut -d'(' -f1 | sort | uniq -c | sort -rn | head -10
```

### 落とし穴
- **実装側の実バグ発見**: テスト型エラーの中に実装の型シグネチャ自体の誤りがある場合、テスト側を曲げず実装修正（または別PBI）で対処
- **2引数 `Mock<A, R>` 形式への書き換え禁止**: vitest 4 は `Mock<T>` 単一引数。モック型は `vi.mocked()` 推論を使う
- **`.value` 系（TS2339 ×56）**: `as HTMLInputElement` 等の要素キャスト。jsdom テストの一般的パターン
- **バッチの切り方**: 1コミット = 1〜3ファイル（vitest 実行で挙動不変を確認）。大きくまとめるとフレーキーな失敗の切り分けが不能

## Definition of Done

- [ ] `npm run type-check:test:raw` exit 0
- [ ] ベースラッパー撤去（`type-check:test` = 素 tsc）
- [ ] `npm run validate` / `test:type-safe` exit 0
- [ ] コードレビュー完了
