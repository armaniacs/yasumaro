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

- [ ] `npm run type-check:test` が exit 0（`tsc --project testDir/tsconfig.json --noEmit`）
- [ ] `npm run test:type-safe` が exit 0（型チェック + 全 vitest）
- [ ] テストファイルに意図的な型エラーを入れるとゲートが落ちることを1度確認（上記シナリオ2）
- [ ] `testDir/__tests__/*.test.ts`（archiveDbReader.test.ts）が型チェック対象に含まれる（rootDir 問題を解決した上で）
- [ ] `npm run validate`（既存ゲート）が引き続き exit 0
- [ ] 本体 `tsconfig.json` の include は変更しない（src 本体の型チェック挙動を変えない）

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

- [ ] `npm run type-check:test` exit 0
- [ ] `npm run test:type-safe` exit 0
- [ ] `npm run validate` exit 0（既存ゲート無傷）
- [ ] コードレビュー完了
