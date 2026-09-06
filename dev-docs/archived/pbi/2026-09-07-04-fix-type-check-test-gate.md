# PBI: `type-check:test` ゲートの修理（types エントリの globals 不備）

## ユーザーストーリー

yasumaroの開発者として、`npm run type-check:test`（`testDir/tsconfig.json`）がグリーンになってほしい。なぜなら、`npm run test:type-safe`（= `type-check:test && npm test`）がテスト側の型安全ゲートとして存在するのに、現在 15,532 errors・exit 2 で常に壊れており、ゲートとして機能していないから。

## 分析: 既存破損（本PBI作成時点の実測 2026-09-07）

- `npm run type-check:test` → **exit 2 / 15,532 errors**（`npm run validate` には含まれないため毎日の開発は回っている。`test:type-safe` が壊れている状態）
- エラー内訳（実測）:
  - **7,351 × TS2304**（`Cannot find name 'describe' / 'it' / 'expect' / 'vi' / 'beforeEach'`）
  - **4,993 × TS2593**（`Cannot find name 'describe'. Do you need to install type definitions for a test runner?`）
  - 残り ~3,200 は上記のカスケード（TS2532 / TS2503 / TS2345 等）
- 根本原因（強い見込み）:
  - `testDir/tsconfig.json` の `types: ["vitest", "node", "chrome"]` — **`"vitest"` はモジュール型を提供するだけでグローバル API（describe/it/expect/vi）を露出しない**。vitest 4.1.11 + `globals: true`（testDir/vitest.config.ts:17）の構成では `"vitest/globals"` が必要
  - `tsconfig.json`（基底）の `rootDir: "src"` を testDir 側が extends して override していないため、src 配下以外のファイル（testDir/__tests__ 等）を include に足すと TS6059 になる（2026-09-07-01 実装時に実測。archiveDbReader.test.ts は型チェック対象外のまま）
  - TypeScript 6.0.3 での動作未検証ポイント: `"vitest/globals"` の解決（nodeNext での exports フィールド解決）

## ユーザーストーリー

yasumaroの開発者として、テストコードにも型チェックが効いてほしい。なぜなら、E2E spec・unit テストの型エラー（例: 存在しないフィールド参照、null安全性の抜け）が実行時まで発見されず、CI グリーンでも壊れたテストをマージするリスクがあるから。

## BDD受け入れシナリオ

```gherkin
Scenario: テスト用 tsconfig の型チェックが通る
  Given testDir/tsconfig.json が vitest グローバル型を参照している
  When npm run type-check:test を実行する
  Then exit code 0 で終了する
  And 出力に error TS が 0 件である

Scenario: 型ゲートが実際に壊れたコードを検出する
  Given 任意のテストファイルに存在しないメソッド呼び出しを1行追加する
  When npm run type-check:test を実行する
  Then exit code 非0 で終了する（ゲートとして機能している証拠）
```

## 受け入れ基準

- [x] `npm run type-check:test` が exit 0（ベースラインゲート: 各ファイルのエラー数がベースライン以下なら 0）
- [x] `npm run test:type-safe` が exit 0（型チェック + 全 vitest）
- [x] テストファイルに意図的な型エラーを入れるとゲートが落ちることを1度確認（実施済み: `NEW FILE` として検出・exit 1）
- [x] `testDir/__tests__/*.test.ts`（archiveDbReader.test.ts）が型チェック対象に含まれる（rootDir を `..` に上書きし include に追加。エラー 0 のためベースライン外 = 新規エラーは即検出）
- [x] `npm run validate`（既存ゲート）が引き続き exit 0
- [x] 本体 `tsconfig.json` の include は変更しない（src 本体の型チェック挙動を変えない）

## 逸脱メモ（見積もりと実態の差・スコープ分割 — ユーザー確認済み）

**見込みと実態**: 「ほぼ types 設定系の1発修正見込み」は誤りだった。設定修理は正しく globals 未解決の 15,532 errors を消滅させたが、その後 **326 ファイル・3,173 件の「未型チェックだったテストの実在する型エラー」** が顕在化（null 安全性・モック型付け・暗黙 any・引数不一致など、1件ずつの判断が必要）。

**採用した解決**:
1. 設定修理（本PBI）: `types: ["chrome", "vitest/globals", "node"]` + `rootDir: ".."` — 15,532 → 3,173。vitest 4 は `vi` を値としてのみ公開（`globals.d.ts` の `let vi` 宣言）し、型名前空間（`vi.Mock` 等）は削除されているため、globals では値使用しか解決しない
2. 安全なコードモド（本PBI・実測で動作確認済み）:
   - vitest 4 で削除された `vi.*` 型名前空間 → 型名直接 import へ機械置換（37 ファイル・325 errors）。`Mock`/`Mocked`/`MockedFunction`/`MockedClass`/`MockInstance` は root export 存在を確認。ジェネリクスは全て単一引数形（`<typeof fn>`）で vitest 4 の `Mock<T>` と互換（2引数形の使用はゼロを実測）
   - 不要になった `@ts-expect-error` の除去（27 ファイル・265 directives）
   - 3,173 → **2,601**（309 ファイル）
3. ベースラインゲート（本PBI）: `scripts/check-type-baseline.mjs` — ファイル別エラー数を `testDir/type-check-baseline.json` と比較し、**新規エラー・件数増で exit 1**、改善時はベースライン更新を促す。既存債務はベースラインに記録して保留
4. 全量返済（2,601 件・309 ファイル）は **2026-09-07-07** に切り出し（ベースラインファイルがインベントリ）

**DoD の意味論**: `type-check:test` は素の tsc ではなくベースラッパーになった（素の tsc は `type-check:test:raw` に残置）。exit 0 の条件は「エラー数がベースライン以下」。

## テスト戦略

### 単体テスト
- なし（ゲート自体が検証）。`type-check:test` の exit code が DoD

### E2Eテスト
- なし

## 実装アプローチ

1. 診断: `testDir/tsconfig.json` の `types` を `["chrome", "vitest/globals", "node"]` に変更してエラー数を再計測
2. カスケード残存なら `@types/node` と TS 6.0.3 の相性、`"vitest/globals"` の nodeNext 解決を確認（`node_modules/vitest/globals.d.ts` の存在確認）
3. rootDir 問題: testDir/tsconfig.json に `"rootDir": ".."` を追加するか、include を分離して対処。**本体 tsconfig.json は触らない**
4. グリーン後、`package.json` の `validate` に `type-check:test` を足すかは別判断（本PBIでは `test:type-safe` の修復まで）

## 見積もり

1pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: なし（単独で着手可）
- **テスタビリティ**: exit code で判定可能
- **非機能要件**: なし

## 実装者向け注記

### 現状コードの確認
```bash
npm run type-check:test 2>&1 | grep -oE "error TS[0-9]+" | sort | uniq -c | sort -rn | head -5
cat testDir/tsconfig.json
node -e "console.log(require('typescript/package.json').version, require('vitest/package.json').version)"
```

### 落とし穴
- **`"vitest"` → `"vitest/globals"` で足りない場合**: TS 6.0.3 の types 解決（`node_modules/vitest/package.json` の exports）を確認。`"types": ["vitest/globals"]` が解決しないなら `typeRoots` か `moduleResolution` を疑う
- **カスケードエラー**: globals 修復後に残る ~3,000 errors は個別に見る（大半は undefined だった `describe/it` 由来の推論崩れで、修復後に消える見込み）。残ったものだけ個別修正
- **`.js` 拡張子 import**: テスト内の import は nodeNext 前提。allowImportingTsExtensions と喧嘩しないこと（現行 testDir/tsconfig.json の設定を維持）
- **E2E spec（testDir/e2e/*.spec.ts）は型チェック対象にしなくてよい**: playwright 自身がトランスパイルする。本PBIは `../src/**/__tests__/**` と `./__tests__/` を対象にする

## Definition of Done

- [x] `npm run type-check:test` exit 0（ベースラインゲートとして）
- [x] `npm run test:type-safe` exit 0
- [x] `npm run validate` exit 0（既存ゲート無傷）
- [x] コードレビュー完了

## 完了メモ（2026-09-07）

### 産出物
- `testDir/tsconfig.json`: `types` に `vitest/globals`（TS 6.0.3 / nodeNext で解決確認済み）、`rootDir: ".."`、include に `./__tests__/**` と `./e2e/fixtures/**`（fixtures はエラー 0）
- `scripts/check-type-baseline.mjs`: ファイル別ベースラインゲート（新規ファイルのエラー・件数増で exit 1、改善時はベースライン更新を案内）
- `testDir/type-check-baseline.json`: 2,601 errors / 309 ファイル（インベントリ = PBI 07 の入力）
- `package.json`: `type-check:test`（ラッパー）/ `type-check:test:raw`（素 tsc）/ `type-check:test:baseline`（再生成）
- コードモド: 68 ファイル（vi 型名前空間 37 + 不要 expect-error 27 + その他）

### 検証
- ネガティブテスト: テストファイルに意図的エラーを追加 → `NEW FILE ... 1 errors` 検出・exit 1（実施済み）
- 改善テスト: ベースライン以下なら exit 0 + 更新案内
- `validate` exit 0（tagClusterLayoutPerf の1回の flake は無関係・単独再実行で通過、本PBI変更範囲外）

### フォローアップ
- 2026-09-07-07（新規）: 型債務全量返済（2,601 件・309 ファイル）。ベースラインを 0 にして `type-check:test:raw` をゲートに昇格させる
