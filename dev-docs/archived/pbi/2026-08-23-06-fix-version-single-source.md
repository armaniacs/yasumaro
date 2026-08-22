# PBI: バージョン単一ソース化 — 3重ハードコードの解消

## ユーザーストーリー
リリース担当者として、バージョンを1箇所で変更すれば全ファイルに反映されてほしい、なぜなら `wxt.config.ts:24` / `sbom.json:5` / `docs/version.json:2`（および `package.json`）に `6.7.64` がハードコードされ、手動同期が必要なため、更新漏れで `check-version-consistency.js` が失敗し、store審査でバージョン不一致としてリジェクトされるから

## 優先度
- 順位: 6 / 12
- RICEスコア: 66.7 (Reach=20 / Impact=1 / Confidence=100% / Effort=0.30人月)
- 根拠: 月1リリースで必ず発生する手動同期。Confidence 100%で毎回リスク。storeリジェクトはビジネスに直結するが、checkスクリプトで事前検出できるためImpactは1。Effortはpackage.json SSOT化とビルド時生成でやや高め

## ビジネス価値
- 信頼性: バージョン不一致によるstoreリジェクトをゼロに。リリース作業の手動ステップを削減
- 効率: `npm version patch` 1回で全ファイル更新、人的ミス排除
- 測定: `package.json` のみ変更して `npm run build` で `wxt.config.ts` 由来のmanifestと `docs/version.json` が自動で同期される

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — package.jsonのバージョンが全ファイルに反映される
  Given package.json の version を 6.7.65 に変更した
  When npm run build を実行する
  Then dist/**/manifest.json の version が 6.7.65 である
  And docs/version.json の version が 6.7.65 である
  And sbom.json の version が 6.7.65 である（generate-sbom時）

Scenario: 境界ケース — check-version-consistency が不要になる
  Given SSOT化が完了している
  When scripts/check-version-consistency.js を実行する
  Then 全ファイルが一致し、常にパスする（またはスクリプト自体が不要になり削除されている）
  And CIでバージョン不一致エラーが出ない

Scenario: エラーケース — package.jsonのバージョンが不正でもビルド時に検出される
  Given package.json の version が 'invalid' や '' である（テストでモック）
  When ビルドまたはバージョン検証を実行する
  Then semver形式でないことが検出され、ビルドが失敗する
```

## 受け入れ基準
- [ ] `wxt.config.ts:24` の `version: '6.7.64'` が `import pkg from './package.json' with { type: 'json' }` または `readFileSync` による動的読込に置換されている
- [ ] `docs/version.json` がビルド時生成（例: `scripts/sync-version.mjs`）または `wxt.config.ts` からのコピーで自動更新される
- [ ] `sbom.json` の version は `npm run generate-sbom` 時に package.json から自動生成される（現状もそうだが、手動編集しない運用が明文化）
- [ ] `scripts/check-version-consistency.js` がSSOT化後は不要になるか、SSOTを検証する形に更新されている
- [ ] `package.json` の version を変更して `npm run build` するだけで全ファイルが同期されることを手動確認

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- `package.json` のversionを一時的に変更し `npm run build` で `dist/manifest.json` と `docs/version.json` が追従することを確認（手動E2E相当、CIではスクリプトで自動検証）

### 統合テスト
- `scripts/check-version-consistency.js` のテスト: package.jsonから読んだversionがwxt.config.tsと一致することをassert
- `wxt.config.ts` のmanifest生成テスト: versionがpackage.json由来であることを検証

### 単体テスト
- `scripts/sync-version.mjs`（新規）のテスト: package.json → docs/version.json のコピーが正しく行われる
- semverバリデーションテスト: 不正versionでthrow

## 実装アプローチ
- **Outside-In**: 統合 version同期テスト(失敗) → 単体 syncスクリプトテスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD
- **段階的**: まず wxt.config.ts の動的読込、次に docs/version.json の自動生成、最後に checkスクリプトの更新

## 見積もり
3pt（要チーム見積もり）— 複数ファイルの生成フロー変更とCI更新を含むため中規模

## 技術的考慮事項
- 依存関係: 05 host_permissions生成と同ファイル（wxt.config.ts）のため同バッチ推奨。独立して実施しても衝突するが小さい
- テスタビリティ: `wxt.config.ts` はESMで `import` するが、JSON importは `with { type: 'json' }` がNode 22+で必要。代替として `createRequire` や `readFileSync` も検討
- 非機能要件: ビルド時間への影響は無視できる
- 既存資産: `scripts/check-version-consistency.js` は既に3ファイルの同期を検証。SSOT化後はこのスクリプトを「SSOTからの生成が正しいか」の検証に転用できる
- sbom.json: `sbom.json:5` の `version: 1` はSBOMフォーマットバージョンで、アプリバージョンではない。混同しない。アプリバージョンは `metadata.component.version: 6.6.6`（現在乖離あり、これもSSOT化で解消）

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "version" wxt.config.ts package.json docs/version.json sbom.json | head -20
cat scripts/check-version-consistency.js
cat package.json | grep version
ls scripts/sync*.mjs 2>&1 | head -10
```

### 実装手順
1. `wxt.config.ts` を SSOT化:
   ```ts
   import { readFileSync } from 'node:fs';
   const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
   // manifest: { version: pkg.version, ... }
   ```
   または
   ```ts
   import pkg from './package.json' with { type: 'json' };
   ```
   （Node 24想定、wxtのvite経由なら `with` が使えるか確認）
2. `scripts/sync-version.mjs` を新規作成:
   ```js
   import { readFileSync, writeFileSync } from 'node:fs';
   const pkg = JSON.parse(readFileSync('package.json','utf8'));
   writeFileSync('docs/version.json', JSON.stringify({ version: pkg.version }, null, 2) + '\n');
   ```
   `package.json` の `build` スクリプトに `node scripts/sync-version.mjs &&` を前置
3. `sbom.json` は `npm run generate-sbom` で再生成されるため、手動編集せずCIで生成することを `CONTRIBUTING.md` に明記
4. `scripts/check-version-consistency.js` を更新: 生成後の `docs/version.json` と `dist/manifest.json` を検証する形に
5. `npm run build && cat docs/version.json && cat dist/**/manifest.json | grep version` で確認

### 落とし穴
- `wxt.config.ts` は `wxt` コマンドが読むため、`readFileSync('./package.json')` の相対パスは `process.cwd()` 基準。`import.meta.url` 基準で `join(dirname(fileURLToPath(import.meta.url)), 'package.json')` が安全
- `docs/version.json` をビルド時生成にすると、Gitで常に差分が出る。`.gitignore` せずコミットする運用なら、pre-commitで自動生成するか、CIで検証のみにするか判断が必要
- `sbom.json` の `metadata.component.version` は `6.6.6` で乖離中（package.jsonは6.7.64）。SSOT化で即時解消されるが、差分が大きいためレビューで驚かれないようPR説明に明記
- `package.json` の `version` を `npm version` で上げると自動でgit tagが作られる。既存の `yasumaro-github-release` スキルとの連携を確認

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了（versionのSSOT化をPRで明示）
- [ ] リファクタリング完了
- [ ] ロールバック手段: 旧ハードコードに戻すrevertで切り戻し可能。ただしSSOT化の利便性を失う旨をPRに記載
- [ ] ドキュメント更新済み（CONTRIBUTING.md のリリース手順を「package.jsonのみ変更」に更新、CHANGELOGは従来通り）
