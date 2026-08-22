# PBI: JSON schema / CI 検証 — typoの静かな蓄積防止

## ユーザーストーリー
開発者として、JSONファイルのtypoやフォーマット崩れをCIで即時検出したい、なぜなら `sbom.json:1` / `docs/version.json:1` / `dev-docs/metrics/history.json:1` にJSON schemaやCI検証が無く、typoやカンマ抜け、バージョン形式誤りがリリースまで気づかれず蓄積するから

## 優先度
- 順位: 7 / 12
- RICEスコア: 40 (Reach=20 / Impact=1 / Confidence=80% / Effort=0.40人月)
- 根拠: 開発者20人に影響するが、typoは頻度が低く、気づけば即修正できるためImpactは1。JSON schemaの整備とCI組込みでEffortは中。独立して実施可能

## ビジネス価値
- 品質: JSONのtypoをpre-commit/CIで即時検出、リリース差し戻しを防止
- 効率: 手動レビューでJSONを目視する工数を削減、フォーマットは自動整形に委譲
- 測定: 不正JSONをコミットしようとすると `npm run validate` またはCIで失敗する

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — 正常なJSONはCIをパスする
  Given 全JSONファイルが正しい形式である
  When npm run validate または CI を実行する
  Then JSON schema検証が全パスする
  And ビルドが成功する

Scenario: エラーケース — typoがあるJSONはCIで失敗する
  Given docs/version.json に { "version": "6.7.64", } のような末尾カンマや typo がある（テストで一時的に不正化）
  When npm run validate を実行する
  Then JSON parseエラーまたはschemaエラーで失敗し、該当ファイルと行が表示される
  And CIがブロックされる

Scenario: 境界ケース — sbom.jsonのCycloneDX schema準拠が検証される
  Given sbom.json が CycloneDX 1.6 schemaに準拠している
  When schema検証を実行する
  Then $schema のURLから取得したschemaで検証がパスする
  And 将来 cyclonedx-npm の出力が壊れても検出できる
```

## 受け入れ基準
- [ ] `sbom.json` は `$schema: http://cyclonedx.org/schema/bom-1.6.schema.json` で検証される（既存の$schemaを活用、CIで `ajv` 等で検証）
- [ ] `docs/version.json` にJSON schema（例: `{ type: object, properties: { version: { type: string, pattern: semver } } }`）が定義され検証される
- [ ] `dev-docs/metrics/history.json` にも同様のschemaまたは少なくとも `jsonc` パース検証が追加されている
- [ ] `npm run validate` または新規 `npm run validate:json` で全JSONの検証が実行される
- [ ] CI（GitHub Actions）にJSON検証ステップが追加されている
- [ ] 不正JSONでの失敗テストが存在する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- CIで不正JSONを含むブランチをプッシュし、Actionsが失敗することを確認（手動E2E相当）

### 統合テスト
- `scripts/validate-json.mjs`（新規）のテスト: 正常JSONはpass、不正JSONはthrow
- `ajv` で CycloneDX schema に対する `sbom.json` の検証がpassすることを確認

### 単体テスト
- 各JSONファイルのschemaテスト: 正常系・異常系（typo、型違い、必須フィールド欠落）
- フォーマットテスト: `prettier --check` または `json --check` でフォーマットが統一されている

## 実装アプローチ
- **Outside-In**: 統合 不正JSONでvalidate失敗テスト(失敗) → 単体 schemaテスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD
- **段階的**: まず `docs/version.json` の簡易schemaから、次に `sbom.json` のCycloneDX検証、最後にCI組込み

## 見積もり
3pt（要チーム見積もり）— schema定義とCI組込み、既存JSONの棚卸しを含むため中規模

## 技術的考慮事項
- 依存関係: なし。06 version SSOT化と併せると `docs/version.json` の生成物検証として自然に組み込める
- テスタビリティ: `ajv` は既に `@cyclonedx/cyclonedx-npm` の依存で存在。直接利用可能
- 非機能要件: CI時間への影響は数秒
- 既存資産: `sbom.json` は既に `$schema` を持つがCIで検証されていない。`docs/version.json` と `history.json` はschema無し
- 代替: `prettier` や `eslint` のjsonプラグインでフォーマットのみ担保する方法もあるが、semver等の意味的検証はajvが必要

## 実装者向け注記

### 現状コードの確認
```bash
cat docs/version.json
cat dev-docs/metrics/history.json | head -30
cat sbom.json | head -10
cat package.json | grep -A5 '"scripts"'
cat .github/workflows/*.yml 2>&1 | head -50
ls scripts/validate* 2>&1
```

### 実装手順
1. `scripts/validate-json.mjs` を新規作成:
   ```js
   import Ajv from 'ajv';
   import { readFileSync } from 'node:fs';
   import sbom from '../sbom.json' with { type: 'json' };
   // docs/version.json の簡易schema
   const versionSchema = {
     type: 'object',
     required: ['version'],
     properties: { version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' } },
     additionalProperties: false,
   };
   const ajv = new Ajv();
   const validate = ajv.compile(versionSchema);
   const data = JSON.parse(readFileSync('docs/version.json','utf8'));
   if (!validate(data)) throw new Error(JSON.stringify(validate.errors));
   // sbomは $schema URLから取得したschemaで検証（または簡易的に $schema 存在と bomFormat チェック）
   ```
2. `package.json` に追加:
   ```json
   "validate:json": "node scripts/validate-json.mjs",
   "validate": "npm run lint && npm run type-check && npm test && npm run validate:json"
   ```
   または `validate` に `validate:json` を含める
3. `.github/workflows/ci.yml` に `npm run validate:json` ステップを追加
4. `npm run validate:json` で正常系パス、不正JSONで失敗することを確認

### 落とし穴
- `sbom.json` のCycloneDX schemaは外部URL。CIで毎回fetchすると不安定。ローカルにキャッシュするか、簡易チェック（`bomFormat === 'CycloneDX'` と `components` 配列存在）に留めるか判断
- `dev-docs/metrics/history.json` は巨大（1000行超）。全件schema検証は重い。サンプリングまたは軽量チェック（JSON parse可能か）に留める
- `ajv` のバージョンは `8.20.0` が既存。`ajv@8` の `strict` モードで未知keywordにstrictエラーが出る場合あり。`strict: false` で回避

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了（schemaの網羅性をレビュー）
- [ ] リファクタリング完了
- [ ] ロールバック手段: validateステップをCIから除去するrevertで切り戻し可能
- [ ] ドキュメント更新済み（CONTRIBUTING.md に `npm run validate:json` を追記）
