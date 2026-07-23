# PBI: 未使用依存パッケージの削除

## ユーザーストーリー
開発者として、未使用の依存パッケージを削除したい、なぜならバンドルサイズを削減し、依存関係の脆弱性リスクを低減できるから

## ビジネス価値
- **バンドルサイズ削減**: 未使用パッケージを削除することで、インストール時間とビルド時間を短縮
- **脆弱性リスク低減**: 使用していないパッケージのセキュリティアップデート不要
- **保守性向上**: package.json が実際に使用しているパッケージのみを反映

## BDD受け入れシナリオ

```gherkin
Scenario: 未使用依存パッケージを削除してビルドが成功する
  Given package.json に未使用の依存パッケージが存在する
  When  未使用パッケージを削除して npm install を実行する
  Then  package-lock.json が更新される
  And   npm run build が成功する
  And   npm run validate が成功する

Scenario: 削除後に既存機能が動作し続ける
  Given 未使用パッケージを削除した状態
  When  拡張機能をビルドして読み込む
  Then  既存の全機能が正常に動作する
  And   テストがすべてパスする
```

## 受け入れ基準
- [ ] 以下のパッケージが package.json から削除されている
  - `bloomfilter` (dependencies)
  - `@rollup/plugin-commonjs` (devDependencies)
  - `@rollup/plugin-node-resolve` (devDependencies)
  - `css-tree` (devDependencies)
  - `globals` (devDependencies)
  - `tailwindcss` (devDependencies)
- [ ] `npm install` が成功する
- [ ] `npm run build` が成功する
- [ ] `npm run validate` (type-check + test) が成功する
- [ ] package-lock.json が更新されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能のビルドと読み込みが成功することを確認

### 統合テスト
- 既存のユニットテストがすべてパスすることを確認

### 単体テスト
- 削除したパッケージを import している箇所がないことを確認

## 実装アプローチ
- **Outside-In**: ビルドテストから開始し、失敗を確認してから削除
- **Red-Green-Refactor**: 削除後にテストが失敗しないことを確認
- **リファクタリング**: 削除後に package.json を整理

## 見積もり
1pt （低リスク、単純な削除作業）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: ビルドとテストの実行で確認
- 非機能要件: バンドルサイズ削減

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 各パッケージが本当に使われていないことを確認
grep -rn "@rollup/plugin-commonjs" src/ testDir/
grep -rn "@rollup/plugin-node-resolve" src/ testDir/
grep -rn "css-tree" src/ testDir/
grep -rn "globals" src/ testDir/
grep -rn "tailwindcss" src/ testDir/
grep -rn "bloomfilter" src/ testDir/
```

**確認済み**: knip の結果から、これらのパッケージはコード内で import されていない。
- `bloomfilter`: `src/utils/trustDb/bloomFilter.ts` は `./bloomfilter-vendor.mjs` を使用
- `tailwindcss`: `@tailwindcss/vite` は使用されているが、本体は不要
- `@rollup/*`: wxt が内部で処理しているため不要
- `css-tree`, `globals`: 使用箇所なし

### 実装手順
1. package.json から対象パッケージを削除
2. `npm install` を実行して package-lock.json を更新
3. `npm run build` でビルドが成功することを確認
4. `npm run validate` でテストがパスすることを確認
5. 拡張機能を実際に読み込んで動作確認

### 落とし穴
- `tailwindcss` を削除しても `@tailwindcss/vite` は残すこと（Vite プラグインは必要）
- `bloomfilter` 削除後も `bloomfilter-vendor.mjs` は残すこと（実際に使用されている）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（CHANGELOG.md）
