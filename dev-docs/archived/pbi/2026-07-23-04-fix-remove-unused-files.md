# PBI: 未使用ファイルの削除

## ユーザーストーリー
開発者として、未使用のファイルを削除したい、なぜならコードベースを整理し、不要なファイルによる混乱を防げるから

## ビジネス価値
- **コードベースの整理**: 不要なファイルを削除することで、開発者が理解すべきコード量を削減
- **ビルド時間の短縮**: 不要なファイルがビルドプロセスに含まれない
- **保守性向上**: 未使用コードによる混乱を防止

## BDD受け入れシナリオ

```gherkin
Scenario: 未使用ファイルを削除してビルドが成功する
  Given プロジェクトに未使用のファイルが存在する
  When  未使用ファイルを削除する
  Then  npm run build が成功する
  And   npm run validate が成功する

Scenario: 削除後に既存機能が動作し続ける
  Given 未使用ファイルを削除した状態
  When  拡張機能をビルドして読み込む
  Then  既存の全機能が正常に動作する
  And   テストがすべてパスする
```

## 受け入れ基準
- [ ] 以下のファイルが削除されている
  - `docs/assets/pii-sandbox.js` (ビルド成果物)
  - `public/utils/trustDb/bloomfilter-vendor.mjs` (src/ 内のものが使用されている)
  - `scripts/test-gate-false-positive.mjs`
  - `src/__tests__/docs.spec.ts`
  - `src/__tests__/types.ts`
  - `src/background/pipeline/index.ts`
  - `testDir/e2e/test-pages/server.mjs`
  - `testDir/e2e/test-pages/test-extractor.js`
  - `vendor/wa-sqlite/wa-sqlite-async.mjs`
- [ ] `npm run build` が成功する
- [ ] `npm run validate` (type-check + test) が成功する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能のビルドと読み込みが成功することを確認

### 統合テスト
- 既存のユニットテストがすべてパスすることを確認

### 単体テスト
- 削除したファイルを import している箇所がないことを確認

## 実装アプローチ
- **Outside-In**: ビルドテストから開始し、失敗を確認してから削除
- **Red-Green-Refactor**: 削除後にテストが失敗しないことを確認
- **リファクタリング**: 削除後に不要な参照を整理

## 見積もり
2pt （中リスク、各ファイルの役割を確認する必要がある）

## 技術的考慮事項
- 依存関係: PBI-03（未使用依存パッケージ削除）を先に実施することを推奨
- テスタビリティ: ビルドとテストの実行で確認
- 非機能要件: コードベースの整理

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 各ファイルが本当に使われていないことを確認
grep -rn "docs/assets/pii-sandbox.js" .
grep -rn "public/utils/trustDb/bloomfilter-vendor.mjs" .
grep -rn "scripts/test-gate-false-positive.mjs" .
grep -rn "src/__tests__/docs.spec.ts" .
grep -rn "src/__tests__/types.ts" .
grep -rn "src/background/pipeline/index.ts" .
grep -rn "testDir/e2e/test-pages/server.mjs" .
grep -rn "testDir/e2e/test-pages/test-extractor.js" .
grep -rn "vendor/wa-sqlite/wa-sqlite-async.mjs" .
```

**確認済み**: knip の結果から、これらのファイルはどのエントリポイントからも import されていない。

**注意すべきファイル**:
- `docs/assets/pii-sandbox.js`: ビルド成果物の可能性。`npm run build:docs-pii` で再生成可能か確認
- `public/utils/trustDb/bloomfilter-vendor.mjs`: `src/utils/trustDb/bloomfilter-vendor.mjs` が実際に使用されている。public/ 版は不要
- `vendor/wa-sqlite/wa-sqlite-async.mjs`: wa-sqlite のベンダーファイル。node_modules 版が使用されているか確認

### 実装手順
1. 各ファイルの役割を確認（ビルド成果物か、手動で追加されたファイルか）
2. 削除しても安全なファイルを特定
3. 対象ファイルを削除
4. `npm run build` でビルドが成功することを確認
5. `npm run validate` でテストがパスすることを確認
6. 拡張機能を実際に読み込んで動作確認

### 落とし穴
- `docs/assets/pii-sandbox.js` はビルドスクリプトで生成される可能性。削除前に `npm run build:docs-pii` の実行確認
- `vendor/` ディレクトリのファイルは、手動で追加されたベンダーファイルの可能性。削除前に node_modules 版で代替可能か確認
- `testDir/e2e/test-pages/` のファイルは E2E テストで使用されている可能性。テスト設定を確認

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（CHANGELOG.md）
