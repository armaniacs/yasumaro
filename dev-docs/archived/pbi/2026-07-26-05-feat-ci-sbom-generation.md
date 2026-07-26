# PBI: CI/CDパイプラインにSBOM生成と脆弱性ゲートを追加する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟢なし（CI追加ステップのみ、既存ビルド・デプロイフローには影響しない）

## 実装メモ（2026-07-26）

フェーズ0確認で、脆弱性ゲート自体（`npm audit --audit-level=high --omit=dev`）は既に
`.github/workflows/ci.yml:36` に存在することを確認した。今回追加が必要だったのはSBOM生成部分のみ。

SBOM生成ツールの導入方法（`npx`即時実行 vs devDependency固定）についてユーザーに確認し、
なぜなぜ分析の結果「SBOMの目的（サプライチェーン透明性の担保）と手段（ツール自体の再現性）を
一致させるべき」という判断で `@cyclonedx/cyclonedx-npm`（^6.0.0）をdevDependencyとして追加した。

`package.json` に `generate-sbom` スクリプト（`cyclonedx-npm --output-file sbom.json`）を追加し、
`ci.yml` の `validate` ジョブに「Generate SBOM」「Upload SBOM」ステップを追加した（既存の
`check-licenses`/`Security audit` ステップの直後、保持期間90日）。ローカルで実際に
`npm run generate-sbom` を実行し、CycloneDX 1.6形式の正しいSBOMが生成されることを確認した。
`sbom.json` は成果物ファイルのため `.gitignore` に追加した。

新規devDependency自体に15件のhigh脆弱性警告が出たが、全てdevDependency側のみ（`--omit=dev`では
0件）で、既存のCIゲート（本番相当の`--omit=dev`監査）には影響しないことを確認した。
`check-licenses`（727パッケージ）・型チェック・全テストスイート（7361件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Supply Chain & Dependency Sentinel からの指摘。`.github/workflows/` にSBOM（Software Bill of Materials）生成の仕組みがない。依存関係の脆弱性が推移的依存経由で混入した場合に検出が遅れるリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rln "cyclonedx\|audit-ci\|sbom" .github/workflows/
cat .github/workflows/ci.yml | grep -n "check-licenses\|npm audit"
```

既存の `ci.yml` に `check-licenses`（`scripts/check-licenses.mjs`）が既に存在することを確認済み（別PBIの調査で判明）。SBOM生成はこれとは別の仕組みであり、重複しないよう設計する。

## 受け入れ基準（BDD）

```gherkin
Scenario: CIでSBOMが生成される
  Given CIワークフローが実行される
  When ビルドステップが完了する
  Then CycloneDX形式（またはSPDX形式）のSBOMファイルがアーティファクトとして生成される

Scenario: 既知の脆弱性が検出された場合CIが失敗する
  Given 依存関係に既知の脆弱性（CVE）が含まれる
  When audit-ci等の脆弱性スキャンステップを実行する
  Then 重大度が閾値（例: high以上）を超える脆弱性がある場合はCIが失敗する

Scenario: 既存のライセンスチェックと共存する
  Given ci.yml に既存の check-licenses ステップがある
  When SBOM生成・脆弱性スキャンステップを追加する
  Then 既存のライセンスチェックステップは変更されず引き続き動作する
```

## 受け入れ基準
- [ ] `.github/workflows/ci.yml`（または新規ワークフロー）に `cyclonedx-bom` 等を用いたSBOM生成ステップを追加する
- [ ] `audit-ci`（または `npm audit --audit-level=high` 相当）による脆弱性ゲートを追加する
- [ ] 既存の `check-licenses` ステップと重複・競合しないことを確認する
- [ ] 生成されたSBOMをCIアーティファクトとして保存する

## テスト戦略

### 統合テスト
- CIワークフローをローカルまたはPRで実際に実行し、SBOM生成・脆弱性スキャンが正常動作することを確認

## 実装アプローチ

1. `cyclonedx-bom`（Node.js向け）または類似ツールを選定
2. `ci.yml` に新規ステップとして追加
3. `audit-ci` を導入し、重大度閾値を設定
4. PRで実際にCIを実行し動作確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: 新規devDependency（`cyclonedx-bom`, `audit-ci`等）の追加
- 非機能要件: サプライチェーンセキュリティ

## Definition of Done
- [ ] SBOM生成ステップがCIに追加されている
- [ ] 脆弱性ゲートが追加されている
- [ ] 既存のCIステップと共存できている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Supply Chain & Dependency Sentinel指摘）
- 対象コード: `.github/workflows/ci.yml`
