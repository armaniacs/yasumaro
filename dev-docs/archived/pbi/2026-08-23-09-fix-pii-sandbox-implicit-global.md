# PBI: pii-sandbox 暗黙global依存解消 — ReferenceErrorと上書き対策（統合）

## ユーザーストーリー
開発者として、docsのPIIサンドボックスが暗黙のglobal `PiiSanitizer` に依存せず明示的にimportしてほしい、なぜなら `docs/assets/pii-sandbox.js:6` の `new PiiSanitizer()` が暗黙globalに依存すると、攻撃者が同一iframeで先に `window.PiiSanitizer` を上書きしたり、load順変更で `ReferenceError` が発生し、docsのデモが破綻するから

## 優先度
- 順位: 9 / 12
- RICEスコア: 20 (Reach=10 / Impact=0.5 / Confidence=80% / Effort=0.20人月)
- 根拠: SEC-4とMTN-11の統合PBI。docs訪問者10人にのみ影響するが、ReferenceErrorは再現性低くImpact 0.5。修正はdocs-src/pii-sandbox.tsのimport整理と存在チェックで低工数。依存: 10 window freezeの前提、08 hardcoded demoと同バッチで09→10→08の順に実施

## ビジネス価値
- 信頼性: load順変更や攻撃者上書きでも `ReferenceError` でページ全体が壊れない
- セキュリティ: 暗黙globalは攻撃者が先に定義できる。明示importで面を削減
- 測定: `docs/assets/pii-sandbox.js` のtop-levelに `new PiiSanitizer` の暗黙参照が無く、存在チェックをパスした時のみ実行される

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — 正常なload順でsanitizeが動作する
  Given docsページが正常にロードされ、PiiSanitizerが正しくimportされている
  When ユーザーがテキストを入力しsanitizeを実行する
  Then 正常にマスクされた結果が返る
  And consoleにReferenceErrorが出ない

Scenario: 境界ケース — PiiSanitizerが未定義でもページが壊れない
  Given 攻撃者が先に window.PiiSanitizer = null を注入した（テストでモック）
  When docsページがロードされる
  Then 存在チェックで早期returnまたはエラーメッセージが表示され、ページ全体は壊れない
  And ReferenceErrorがthrowされない

Scenario: エラーケース — import順が変わってもReferenceErrorにならない
  Given docs/assets/pii-sandbox.js のload順を意図的に遅延させた（テストで遅延ロード）
  When ページがロードされる
  Then 明示importにより PiiSanitizer が解決され、ReferenceErrorが出ない
  And sanitizeが正常に動作する
```

## 受け入れ基準
- [ ] `docs-src/pii-sandbox.ts` が `src/utils/piiSanitizer.js` から `sanitizeRegex` 等を明示importしている（現状は `import { sanitizeRegex, MAX_INPUT_SIZE } from '../src/utils/piiSanitizer.js'` で既に明示 — 指摘の `new PiiSanitizer()` は旧成果物の残留か要確認）
- [ ] `docs/assets/pii-sandbox.js` の成果物に `new PiiSanitizer()` の暗黙global参照が無い
- [ ] 存在チェック `if (typeof PiiSanitizer === 'undefined')` または try-catch が追加されている（旧コードが残る場合）
- [ ] `npm run build:docs-pii` 後の成果物で `grep -n "PiiSanitizer" docs/assets/pii-sandbox.js` が明示import由来のみである
- [ ] docsページで手動テストがパス

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Playwrightでdocsページを開き、consoleにReferenceErrorが出ないことを確認
- 攻撃者上書きシナリオ: `page.evaluate(() => window.PiiSanitizer = null)` 後にリロードし、ページが壊れないことを確認

### 統合テスト
- `docs-src/pii-sandbox.ts` のビルド成果物を検査し、暗黙global参照が無いことをassert
- `esbuild` のbundle結果をスナップショットテスト

### 単体テスト
- `docs-src/pii-sandbox.test.ts`（新規）で、PiiSanitizer未定義時のフォールバックをモックで検証
- `src/utils/piiSanitizer.test.ts` は既存でカバー、ここではimport解決のみ

## 実装アプローチ
- **Outside-In**: E2E ReferenceError無しテスト(失敗) → 統合 成果物検査テスト(失敗) → 単体 存在チェックテスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD

## 見積もり
2pt（要チーム見積もり）— 現状 `docs-src/pii-sandbox.ts` は既に明示importしており、旧成果物の再ビルドで解消する可能性。調査を含むため2pt

## 技術的考慮事項
- 依存関係: 10 window freeze の前提。暗黙globalを解消してからfreezeをかけると順序が自然。08 hardcoded demoと同バッチ
- テスタビリティ: `docs-src/pii-sandbox.ts` はESMでテスト容易。成果物の暗黙globalは `grep` で検出
- 非機能要件: 影響はdocsのみ、拡張機能本体には波及しない
- 現状の乖離: 指摘の `docs/assets/pii-sandbox.js:6` は、現行 `docs-src/pii-sandbox.ts`（15行）には存在しない。`src/utils/piiSanitizer.ts` の `class PiiSanitizer` を `new` している旧版の成果物が残っている可能性。まず `cat docs/assets/pii-sandbox.js | grep -n "PiiSanitizer"` で現状確認が必要
- 統合理由: SEC-4（セキュリティ: 上書き可能）とMTN-11（保守: ReferenceError）は同一根因。分離すると同一ファイルの同一行を二重修正することになるため統合

## 実装者向け注記

### 現状コードの確認
```bash
cat docs-src/pii-sandbox.ts
grep -n "PiiSanitizer" docs/assets/pii-sandbox.js src/utils/piiSanitizer.ts docs-src/pii-sandbox.ts
cat src/utils/piiSanitizer.ts | grep -n "class PiiSanitizer" | head -5
cat package.json | grep build:docs-pii
```

### 実装手順
1. 現状確認:
   ```bash
   grep -n "new PiiSanitizer\|PiiSanitizer" docs/assets/pii-sandbox.js
   ```
   現行成果物に `new PiiSanitizer()` があれば、旧版の残留。`npm run build:docs-pii` で再ビルドし、再現するか確認
2. `docs-src/pii-sandbox.ts` が既に `import { sanitizeRegex } from '../src/utils/piiSanitizer.js'` なら、暗黙globalは解消済み。成果物側で `new PiiSanitizer()` が残るなら、ビルド成果物を `git diff` で確認し、旧コードを除去
3. 存在チェックを追加（旧コードが残る場合の防御）:
   ```ts
   import { sanitizeRegex } from '../src/utils/piiSanitizer.js';
   if (typeof sanitizeRegex !== 'function') throw new Error('PiiSanitizer not loaded');
   ```
4. `npm run build:docs-pii && grep -n "PiiSanitizer" docs/assets/pii-sandbox.js` で確認

### 落とし穴
- `esbuild --bundle` は `src/utils/piiSanitizer.ts` をinline展開するため、成果物に `class PiiSanitizer` が展開されるが、これは正常。問題は `new PiiSanitizer()` が bundle外のglobalを参照している場合
- `docs/assets/pii-sandbox.js` は IIFE で `var PiiSandbox = (() => { ... })()` として生成される。`PiiSandbox` と `PiiSanitizer` を混同しない
- 現行 `docs-src/pii-sandbox.ts` は `sanitizeRegex` を関数としてimportしており、クラス `PiiSanitizer` を直接 new していない。指摘は旧実装の可能性が高い — まず再現確認を徹底

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了（暗黙globalが解消されたことをPRでgrep結果貼付け）
- [ ] リファクタリング完了
- [ ] ロールバック手段: 旧成果物を復活させるrevertで切り戻し可能
- [ ] ドキュメント更新済み（不要なら更新なし、旧成果物の残留だった旨をPRに記載）
