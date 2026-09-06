# PBI: テスト型債務返済 1/5 — background（742 errors / 87 ファイル）

## ユーザーストーリー

yasumaroの開発者として、`src/background` 配下のテスト（録画パイプライン・Obsidian 連携・SW コアなど最重要経路のテスト群）に型チェックの生のゲートが効いてほしい。なぜなら、型債務の中には将来の実バグ（undefined アクセス・API 変更の追従漏れ）の予兆が含まれるから（シリーズ共通の背景は `pbi/00-INDEX.md` の「2026-09-07 テスト型債務返済シリーズ」参照）。

## 分析: 本バッチのスコープ（実測 2026-09-07、インベントリ = testDir/type-check-baseline.json）

- スコープ: **`src/background/**` の baseline エントリ** — 742 errors / 87 files（シリーズ全体 2,601 / 309 のうち 29%）
- 上位ファイル: `obsidianClient.test.ts`(89)・`service-worker.test.ts`(78)・`tabCache.test.ts`(74)・`obsidianClient-mutex.test.ts`(38)・`GeminiProvider.test.ts`(38)
- エラー内訳（ディレクトリ傾向）: null 安全性（TS2532/TS18047）、モック型付け（TS2339 — `vi.mocked()` 未使用の mock メソッド呼び出し）、引数不一致（TS2345）
- 依存なし・他バッチと並行可（ベースラッパーが常時回帰検知するため）

## ビジネス価値

- 録画・Obsidian 同期・SW コアのテストに型レベルの実害検知を導入する（最重要経路が最初）
- バッチ完了は「87 ファイルがベースラインから消える」ことで客観的に検証できる

## BDD受け入れシナリオ

```gherkin
Scenario: background 配下の型エラーが 0 になる
  Given src/background 配下の baseline エントリが全て返済されている
  When npm run type-check:test:raw を実行する
  Then 出力に src/background 配下の error が 0 件である
  And 全 vitest がグリーン（実行時挙動不変）
```

## 受け入れ基準

- [ ] `src/background/**` が baseline から消滅（`npm run type-check:test:raw` で同配下 0 件）
- [ ] baseline.json から返済済みエントリを削除（合計数が 742 減る）
- [ ] 型レベル修正のみで**テストの実行時挙動を変えない**（全 vitest グリーン維持。1 コミット = 1〜3 ファイル）
- [ ] 返済中に発見した**実装側の実バグ**はテスト側を曲げず別 PBI に切り出す
- [ ] `npm run validate` が exit 0
- [ ] 実装バグ発見が 0 件だった場合も「0 件だった」ことをコミットメッセージかPBIメモに記録

## テスト戦略

### 単体テスト
- なし（既存テストの期待値を変えない。型注釈・型アサーションのみ）

### E2Eテスト
- なし

## 実装アプローチ

1. `type-check:test:raw` の出力を `src/background` でフィルタし、エラー数の多いファイルから順に返済
2. 1 ファイル返済のたび `npx vitest run <file>` で挙動不変を確認 → baseline.json から当該エントリ削除
3. 返済パターン（シリーズ共通）:
   - TS2532/TS18047（null 安全性）: `?.` か `!` — テスト意図に合わせ選択
   - TS2339（mock メソッド）: `vi.mocked(x)` で包む
   - TS7005/7006（暗黙 any）: パラメータ型を付ける
   - TS2345/TS2322（不一致）: テスト意図に合わせモック or 期待値を修正
   - vitest 4 の 2 引数 `Mock<A, R>` 形式は存在しない — `Mock<T>` 単一引数 + `vi.mocked()` 推論を使う

## 見積もり

2pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-04（ベースラインゲート稼働中）が前提。08〜11 は互いに独立・並行可
- **テスタビリティ**: 1 ファイル返済のたび vitest run で挙動不変を確認（`vitest --changed` 可）
- **非機能要件**: 実行時挙動を変えないこと（`as` で誤魔化す場合は理由コメント必須）

## 実装者向け注記

### 現状コードの確認
```bash
npm run type-check:test:raw 2>&1 | grep "src/background" | cut -d'(' -f1 | sort | uniq -c | sort -rn | head -10
```

### 落とし穴
- **実装側の実バグ発見**: 型エラーの中に実装の型シグネチャ自体の誤りがある場合、テスト側を曲げず実装修正（または別PBI）で対処
- **バッチの切り方**: 1コミット = 1〜3ファイル。大きくまとめるとフレーキーな失敗の切り分けが不能
- **`.value` 系（jsdom テスト）**: `as HTMLInputElement` 等の要素キャスト
- **`@ts-expect-error` の新設禁止**: 型を正す。 suppress が必要なケースは理由コメント付き `@ts-ignore` ではなく修正

## Definition of Done

- [ ] `src/background/**` が baseline から消滅
- [ ] `npm run validate` exit 0
- [ ] コードレビュー完了
- [ ] 実装バグ発見の有無をメモに記録
