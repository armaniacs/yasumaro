# PBI: wasm ラッパ .d.ts の any 戻り値を適切な型に置き換える

## ユーザーストーリー

拡張機能の開発者として、WASM ラッパの TypeScript 宣言（PII サニタイザ・タグ共起）が `any` を返さず、呼び出し側が型の恩恵を受けられるようにしてほしい、なぜなら `src/wasm/pii-sanitizer/piiSanitizerWasm.d.ts:9`（`sanitizePii(text: string): any`）と `src/wasm/tag-cooccur/tagCooccurWasm.d.ts:11,20`（`computeCooccurrence` / `narrowToTopTags` が `: any`）が `any` を返すため、CLAUDE.local.md の「any を使わない」規約が本番隣接の型境界で守れておらず、呼び出し側の誤用（存在しないフィールドへのアクセス・null チェック漏れ）がコンパイル時に検知できないから。

## 優先度

- 順位: 04 / 6
- RICE: 24（Reach=30 / Impact=1 / Confidence=80% / Effort=1.0）
- 根拠: PII サニタイザは privacy の要であり型の恩恵は大きいが、呼び出し側の波及と wasm 契約の確認に Effort が掛かる。依存なし
- 種別: 🔧非機能追加（fix） / 難易度: 🟡中 / 副作用: 🟡軽微

## 背景（出典）

2026-10-20 の簡素化パス 未適用発見。`grep ': any'` の本番コード該当はテストコードを除くとこの 2 ファイルの 3 宣言のみ。`.d.ts` の doc comment は戻り値の形を既に記述している:

- `piiSanitizerWasm.d.ts:4-8`: `sanitizePii` は `{ text, maskedItems }`（`SanitizeResult` minus `error`。TS ラッパが size/timeout の handling を上乗せ）
- `tagCooccurWasm.d.ts:4-10`: `computeCooccurrence` は `computeTagCooccurrence(entries)` の形を mirror
- `tagCooccurWasm.d.ts:13-19`: `narrowToTopTags` は `narrowEntriesToTopTags(entries, limit)` の形を mirror

つまり**正しい型は既存 TS パスの型から導出できる**。

### 制約

- `src/wasm/*/*.d.ts` は手書き。`wasm/*/pkg/*.d.ts` は wasm-pack 生成物で本 PBI の対象外（生成物には lint の eslint-disable が既にある）
- 実行時の戻り値契約は wasm パリティテスト（`src/wasm/*/__tests__/parity.test.ts`）が守る
- `wasm/*.rs` を触らない（型宣言のみ）。crate の再ビルド不要

## BDD受け入れシナリオ

```gherkin
Scenario: 呼び出し側の誤用がコンパイル時に検知される
  Given sanitizePii の戻り値が { text: string; maskedItems: ... } 型である
  When 呼び出し側で存在しないフィールド（result.masked 等）にアクセスする
  Then type-check が失敗する
  # 注意: 現行は any のため通ってしまう。これが本 PBI の受入基準。

Scenario: 実行時の挙動が変わらない
  Given 既存の wasm パリティテストがある
  When 型宣言のみを変更して type-check とテストを実行する
  Then パリティテストは無修正で通る
  And sanitizePii / computeCooccurrence / narrowToTopTags の戻り値の実体は変わらない
```

## 受け入れ基準

- [ ] `src/wasm/pii-sanitizer/piiSanitizerWasm.d.ts:9` が `any` ではなく `SanitizeResult` から error を除いた形（または同等の明示的な interface）を返す
- [ ] `src/wasm/tag-cooccur/tagCooccurWasm.d.ts:11,20` が `any` ではなく `computeTagCooccurrence` / `narrowEntriesToTopTags` の戻り値形を返す
- [ ] 呼び出し側で any 由来の黙認されていたアクセスがあれば修正する（type-check が通るまで）
- [ ] `src/wasm/*/__tests__/parity.test.ts` が無修正で通る
- [ ] `wasm/*.rs` と `wasm/*/pkg/`（生成物）を変更していない
- [ ] `npm run validate` が緑

## テスト戦略

### 単体

既存パリティテストが実行時契約を固定。型は `npm run type-check`（厳格 tsc）が検証。

### 統合 / E2E

不要（宣言のみ）。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 役割 |
|---|---:|---|
| `src/wasm/pii-sanitizer/piiSanitizerWasm.d.ts` | 4-9 | sanitizePii 宣言（any）。mirror 元 `SanitizeResult` は `src/utils/piiSanitizer.ts` |
| `src/wasm/tag-cooccur/tagCooccurWasm.d.ts` | 4-20 | computeCooccurrence / narrowToTopTags 宣言（any）。mirror 元は TS パスの同名関数 |
| `src/wasm/*/pkg/` | - | **生成物・対象外**（wasm-pack 出力） |
| `src/wasm/*/__tests__/parity.test.ts` | - | 実行時契約のピン |

### 実装手順（推奨）

1. TS ラッパ（`src/wasm/*/` 内の .ts）が wasm 関数をどう呼び、何を返すかを実ファイルで確認する
2. `.d.ts` の戻り値型を mirror 元の TS 型から定義する（手書き .d.ts から mirror 元を import できない場合は構造を複製し、元型との drift pin をテストに置く）
3. `npm run type-check` で呼び出し側の破れを収集し、必要な箇所だけ明示的な narrow を足す
4. `npx vitest run src/wasm` でパリティを確認

### ロールバック手順

- 変更は `.d.ts`（2 ファイル）と呼び出し側の最小 narrow に切り出す。1 コミット。`git revert` で戻せる。実行時挙動は不変。

## 見積もり

2pt 🟡（呼び出し側の波及確認を含む。Effort=1.0 相当）

## Definition of Done

- [ ] type-check が緑（any の黙認アクセスが 0）
- [ ] パリティテスト無修正で緑
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了

## 関連

- pbi/00-INDEX.md
- pbi/2026-10-20-00-backlog-review-findings.md
- 出典: 2026-10-20 簡素化パス 未適用発見（wasm d.ts の any）
