# PBI: src/utils/を機能別サブディレクトリに分割する

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（100件超のファイル移動とimportパス変更。全プロジェクトに影響する広範な変更）

**実装計画**: `dev-docs/plans/2026-07-27-pbi24-utils-subdirectory-split-plan.md`（2026-07-27作成。crypto/privacy/i18n/cspの4グループに分割、Task→Step分解済み）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Maintainability Guardian からの指摘。`src/utils/` がダンピンググラウンド化しており、プロジェクト全体の約45%のコード（レビュー時222ファイル、58,019行）が集中している。サブディレクトリへの分類が不十分で、新規参画者が「何がどこにあるか」を把握しづらい。

**2026-07-26時点の調査で、`src/utils/` 直下（`__tests__`除く）に103ファイルが存在することを確認した。** レビュー時（222ファイル）より減少しているが、依然として大規模である。既に `src/utils/storage/` のようなサブディレクトリは存在するため、部分的な分割は進んでいる可能性がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
find src/utils -maxdepth 1 -name "*.ts" -not -path "*__tests__*" | wc -l
ls -d src/utils/*/
```

**このPBIは影響範囲が非常に広い（プロジェクト全体のimportパスに影響）。一度に全ファイルを移動するのではなく、最も凝集度の高いグループ（例: crypto関連、privacy関連、domain関連）から段階的に分割する。** 各ファイルの現在の依存関係を確認し、循環依存が生じないグループ分けを設計する。

## 受け入れ基準（BDD）

```gherkin
Scenario: crypto関連ファイルがsrc/utils/crypto/にまとまる
  Given crypto.ts, luhn.ts 等の暗号・検証関連ファイルがsrc/utils/直下に散在する
  When src/utils/crypto/ サブディレクトリへ移動する
  Then 関連ファイルが1箇所にまとまり、import文が更新される

Scenario: 移動後もビルド・テストが成功する
  Given ファイル移動とimportパス更新を行った後
  When npm run build && npm run type-check && npm test を実行する
  Then 全て成功する

Scenario: 段階的な移行が可能である
  Given 一度に全てを移動するとレビューが困難である
  When 1グループ（例: crypto関連）ごとに個別のPRとして進める
  Then 各PRが独立してレビュー・マージ可能である
```

## 受け入れ基準
- [ ] `src/utils/` 直下の全ファイルを機能別にグルーピングする（例: crypto/, privacy/, domain/, i18n/, storage/(既存)）
- [ ] 最も凝集度の高い1グループから移行を開始する（例: `src/utils/privacy/` へ `piiSanitizer.ts`, `privacyConsent.ts` 関連を移動）
- [ ] 移動したファイルを参照する全箇所のimportパスを更新する
- [ ] `npm run type-check` と既存テストスイートが全てパスする
- [ ] 段階的に全グループの移行を完了させる（複数PRに分割してもよい）

## テスト戦略

### 統合テスト
- 各グループの移行完了後、`npm run build && npm run type-check && npm test` が成功することを確認

## 実装アプローチ

1. `src/utils/` の全ファイルを機能別にグルーピングする設計をまず行う（ADRとして記録することを推奨）
2. 最も影響範囲の小さいグループから移動を開始
3. importパスを一括更新（IDEのリファクタリング機能または`grep`+`sed`相当の一括置換を慎重に使用）
4. ビルド・テストで確認しながら段階的に進める

## 見積もり

3pt以上（グルーピング設計 + 段階的な移行、複数PRに分割することを推奨）

## 技術的考慮事項
- 依存関係: プロジェクト全体（100件超のファイルが対象）
- テスタビリティ: 既存の型チェック・テストスイートが土台
- 非機能要件: 保守性

## Definition of Done
- [ ] 機能別グルーピングの設計がADRとして記録されている
- [ ] 少なくとも1グループの移行が完了している
- [ ] ビルド・型チェック・テストが全て成功する
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Maintainability Guardian指摘）
- 対象コード: `src/utils/`（103ファイル、2026-07-26時点）

## フェーズ0再調査（2026-07-27）

**PBI記載の「103ファイル」は既に古い数値。** 前回セッションで`logger.ts`, `aiSummaryCleaner.ts`,
`contentExtractor.ts`, `ublockParser.ts`のバレル削除・サブディレクトリ化を実施した結果、
`src/utils/`直下（`__tests__`除く）は**62ファイルに減少**（41ファイル、約4割減）。既存の
`storage/`, `trustDb/`と合わせ、現在は計6サブディレクトリ（`aiSummaryCleaner/`,
`contentExtractor/`, `logger/`, `storage/`, `trustDb/`, `ublockParser/`）が存在する。

**グルーピング案自体は妥当**: PBIが例示する分類候補（crypto: `crypto.ts`/`typesCrypto.ts`、
privacy: `piiSanitizer.ts`/`piiStripper.ts`/`privacyChecker.ts`/`privacyStatusCodes.ts`、
i18n: `i18n.ts`/`i18n-dom.ts`/`i18nPlural.ts`/`localeUtils.ts`、domain: `domainUtils.ts`/
`cspDomains.ts`）はいずれも未着手のまま直下に残存しており、分類案自体は今も有効。

**PBI-26との関係**: `AIClient`が`../utils/logger.js`, `../utils/errorUtils.js`,
`../utils/auditLog.js`, `../utils/storage.js`をimportしているため、本PBIでこれらのファイルを
移動する場合はPBI-26側のimportパス修正が必要になる。ただし機能的には独立しており、パス依存の
軽微な接点のみで並行実施は可能。

**見積もり再評価**: 対象ファイル数が4割減少しているため、3pt以上という見積もりは**やや過大の
可能性がある**。技術的考慮事項の「100件超のファイルが対象」という記載、実装者向け注記の
`find`確認コマンドの想定結果も62件に更新すべき。
