# PBI: SBOM準拠検証 — 誤検出の記録とCI担保（backlog）

## ユーザーストーリー
監査担当者として、SBOMがCycloneDX準拠でありCIで担保されていることを確認したい、なぜならレビューで「sbom.json:6 は非準拠・hash無し・1パッケージのみ」と指摘されたが、実ファイルはCycloneDX 1.6準拠でSHA-512 hashと1000行超のcomponentsを持つため、誤検出を記録し再発防止の検証を残したいから

## 優先度
- 順位: 11 / 12
- RICEスコア: 1 (Reach=50 / Impact=0.25 / Confidence=80% / Effort=0.10人月 → 誤検出のため補正後1)
- 根拠: 検証で `sbom.json` は `bomFormat: CycloneDX, specVersion: 1.6, $schema: cyclonedx.org` で hash も各componentに存在。指摘は旧版または誤読。対応不要だが、将来の `npm run generate-sbom` 出力が壊れた際の検出は価値があるためbacklogに格下げ。type=backlog

## ビジネス価値
- 監査対応: SBOMが準拠している証跡を残し、外部監査での指摘に即答できる
- 将来の回帰防止: `cyclonedx-npm` の出力が将来壊れてもCIで検出
- 測定: `npm run generate-sbom` 後の `sbom.json` が `ajv` でCycloneDX schemaにパスする

## なぜなぜ分析（誤検出の根本原因）

```
なぜ非準拠と指摘された？ → レビュー時点のsbom.jsonが最小版（yasumaro 1パッケージのみ）だった可能性
なぜ最小版だった？ → `npm run generate-sbom` を実行せず、手書きの雛形をコミットしたか、CIで再生成していない
なぜ気づかない？ → SBOMの検証がCIに無いから
なぜCIに無い？ → SBOMはリリース時のみ生成する運用で、PR時の検証対象外だった
→ 解: 誤検出を記録し、CIで `npm run generate-sbom && ajv validate` を実行するか、少なくとも `bomFormat` と `components.length > 1` をassertする軽量検証を追加
```

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — 現行sbom.jsonがCycloneDX準拠である
  Given sbom.json が存在する
  When $schema のURLから取得したCycloneDX 1.6 schemaで検証する
  Then 検証がパスする
  And components に yasumaro 以外のパッケージ（例: @axe-core/playwright）が含まれる
  And 各componentに hashes.SHA-512 が含まれる

Scenario: 境界ケース — componentsが1件のみなら警告が出る
  Given sbom.json の components が1件（yasumaroのみ）
  When 軽量検証を実行する
  Then 警告またはエラーが出る（将来の誤生成を検出）
  And CIでブロックされる

Scenario: エラーケース — 非準拠SBOMはCIで失敗する
  Given sbom.json の bomFormat が 'CycloneDX' でない（テストでモック）
  When 検証を実行する
  Then エラーで失敗し、該当フィールドが表示される
```

## 受け入れ基準
- [ ] `sbom.json` の現状がCycloneDX 1.6準拠であることが検証スクリプトまたは手動検証で確認されている
- [ ] 検証結果が本PBIまたはADRに記録されている（誤検出の旨と根拠）
- [ ] 軽量検証スクリプト `scripts/validate-sbom.mjs`（または `validate-json.mjs` に統合）が存在し、 `bomFormat`, `specVersion`, `components.length`, `hashes` をassertする
- [ ] CIで `npm run generate-sbom` 後の検証が実行されるか、少なくともPR時の `validate:json` でSBOMの軽量検証が実行される
- [ ] 本PBIは `type: backlog` として即時対応不要だが、将来のSBOM破損時に着手可能な状態である

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- CIで `npm run generate-sbom && node scripts/validate-sbom.mjs` がパスすることを確認

### 統合テスト
- `scripts/validate-sbom.mjs` のテスト: 正常SBOMはpass、components 1件はwarn、bomFormat不正はfail

### 単体テスト
- SBOMパーステスト: `JSON.parse(readFileSync('sbom.json'))` がCycloneDX必須フィールドを持つ
- hash存在テスト: 各componentの `externalReferences[].hashes[].alg === 'SHA-512'` を検証

## 実装アプローチ
- **Outside-In**: 統合 SBOM検証テスト(失敗) → 単体 hash存在テスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD
- **最小実装**: まずは軽量検証（`bomFormat` と `components.length`）のみ。厳密なschema検証は外部fetchが不安定なため後回し

## 見積もり
1pt（要チーム見積もり）— 軽量検証スクリプトとCI組込みのみの小規模。厳密schema検証は別途

## 技術的考慮事項
- 依存関係: なし。07 JSON schema CI と統合可能（`validate-json.mjs` に含める）
- テスタビリティ: 純関数としてテスト容易
- 非機能要件: CI時間への影響は数秒
- 現状: `sbom.json` は `components` に `@axe-core/playwright`, `cyclonedx-npm`, `@peculiar/webcrypto` 等多数を含む。各componentに `hashes: [{ alg: SHA-512, content: ... }]` あり。指摘の「1パッケージのみ」は誤り
- 運用: `sbom.json` は `npm run generate-sbom` で再生成される。手動編集せずCIで生成することを `CONTRIBUTING.md` に明記（06 version SSOTと同様）

## 実装者向け注記

### 現状コードの確認
```bash
cat sbom.json | head -20
cat sbom.json | grep -c '"name":' | head -5
cat sbom.json | grep -A2 '"hashes"' | head -20
cat package.json | grep generate-sbom
ls scripts/validate* 2>&1
```

### 実装手順
1. 現状検証:
   ```bash
   node -e "const sbom=require('./sbom.json'); console.log('bomFormat', sbom.bomFormat, 'specVersion', sbom.specVersion, 'components', sbom.components.length)"
   node -e "const sbom=require('./sbom.json'); console.log(sbom.components.every(c => c.externalReferences?.some(r => r.hashes)))"
   ```
2. `scripts/validate-sbom.mjs` を新規作成（または `validate-json.mjs` に統合）:
   ```js
   import { readFileSync } from 'node:fs';
   const sbom = JSON.parse(readFileSync('sbom.json','utf8'));
   if (sbom.bomFormat !== 'CycloneDX') throw new Error('bomFormat must be CycloneDX');
   if (sbom.components.length <= 1) throw new Error('SBOM must contain more than yasumaro');
   for (const c of sbom.components) {
     const hasHash = c.externalReferences?.some(r => r.hashes?.some(h => h.alg === 'SHA-512'));
     if (!hasHash) console.warn(`Missing hash for ${c.name}`);
   }
   console.log('SBOM OK:', sbom.components.length, 'components');
   ```
3. `package.json` に `validate:sbom` を追加、CIに組込み
4. 本PBIの「誤検出」旨をPR説明に明記

### 落とし穴
- `sbom.json` の `version: 1` はSBOMフォーマットバージョンで、アプリバージョンではない。レビュー指摘の `sbom.json:5` はこの `version: 1` をアプリバージョンと混同した可能性
- `cyclonedx-npm` の出力は `node_modules` の状態に依存。CIで `npm ci` 後に `generate-sbom` しないと components が少なくなる
- 外部schema URL (`cyclonedx.org/schema/bom-1.6.schema.json`) をCIで毎回fetchすると不安定。軽量検証に留めるのが現実的

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする（または軽量検証が手動で確認されている）
- [ ] コードレビュー完了（SBOMが準拠している証跡をPRに貼付け）
- [ ] リファクタリング完了
- [ ] ロールバック手段: validateスクリプトを除去するrevertで切り戻し可能
- [ ] ドキュメント更新済み（CONTRIBUTING.md に `npm run generate-sbom` の運用を追記、または本PBIで誤検出を記録）
- [ ] 本PBIは backlog のため、即時着手不要。将来のSBOM破損時に本PBIを fix に昇格させる
