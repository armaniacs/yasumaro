# PBI: ドメインフィルタ関連コードの構造を整理し責務境界を明確にする

**作成日**: 2026-07-25
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🟡軽微（内部構造の再編。既存のドメインフィルタ機能（simple/uBlock両形式）の挙動を変えないことが必須）

## 実装メモ（2026-07-26）

`dev-docs/ADR/2026-07-26-domain-filter-layer-map.md` として責務分離マップを作成した。8ファイルを分析した
結果、PBI記載の8ファイル目 `src/utils/cspDomains.ts` は実際にはドメインフィルタと無関係（AIプロバイダーの
CSP/ホスト権限設定）であることが判明し、レビュー指摘時の誤認と結論づけた。

残り7ファイルは「UI2層（popup/dashboard） + ロジック2層（simple形式/uBlock形式） + キャッシュ1層 +
パイプライン統合1層」という妥当な層分離になっており、simple/uBlock形式の重複は基礎関数
（`extractDomain`/`matchesPattern`）レベルで既に一元化済みだった。キャッシュ層がuBlock形式を
非対応とする非対称性もコードコメントに明記された意図的設計であり、見落としではないと判断した。

統合が必要な重複ロジックは見つからなかったため、後続の統合PBIは起票していない。コード変更なし、
既存のドメインフィルタ関連テスト（93件）は変更前後で同一に全てパス。

---

## 背景

Checking Team レビュー（2026-07-25）の System Architect からの指摘。ドメインフィルタ関連の実装が `src/popup/domainFilter.ts`(349行)、`src/utils/domainUtils.ts`(198行)、`src/utils/ublockMatcher.ts`(245行)、`src/utils/cspDomains.ts`(69行)、`src/utils/storage/domainFilterCache.ts`、`src/dashboard/domainFilterTagUI.ts`、`src/dashboard/panels/staticForm/domainFilterPanel.ts`、`src/background/pipeline/steps/checkDomainFilterStep.ts` の最低8ファイルに分散している。simple形式とuBlock形式が並存し、設定項目・UI要素が増加し続けている。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
wc -l src/popup/domainFilter.ts src/utils/domainUtils.ts src/utils/ublockMatcher.ts src/utils/cspDomains.ts src/utils/storage/domainFilterCache.ts src/dashboard/domainFilterTagUI.ts src/dashboard/panels/staticForm/domainFilterPanel.ts src/background/pipeline/steps/checkDomainFilterStep.ts
```

**このPBIは規模が大きく、一度に全体を再設計するのはリスクが高い。** まず各ファイルの責務（UI表示 / マッチングロジック / キャッシュ / CSP連携 / パイプライン統合）を一覧化し、責務ごとのレイヤー図を作成することからスコープを絞って着手する。実装の統合は本PBIの範囲外とし、まず「整理された設計ドキュメント + 明確な責務分離の提案」を成果物とする。

## 受け入れ基準（BDD）

```gherkin
Scenario: ドメインフィルタ関連ファイルの責務が明文化される
  Given 8ファイルに分散したドメインフィルタ実装
  When 各ファイルの責務（UI/ロジック/キャッシュ/CSP/パイプライン）を分析する
  Then 責務ごとのレイヤー図とファイル対応表がドキュメント化される

Scenario: 責務の重複・境界の曖昧さが特定される
  Given 責務分析の結果
  When simple形式とuBlock形式のロジックの重複箇所を洗い出す
  Then 統合可能な箇所と、意図的に分離すべき箇所が明確になる

Scenario: 既存機能の挙動が変わらない（ドキュメント化フェーズでは変更なし）
  Given このPBIではドキュメント化のみを行う
  When 既存のドメインフィルタテストを実行する
  Then コード変更がないため全てパスする
```

## 受け入れ基準
- [ ] ドメインフィルタ関連8ファイルの責務を一覧化した表を `dev-docs/ADR/` にADRとして作成する
- [ ] simple形式とuBlock形式のロジック重複箇所を特定する
- [ ] 統合・整理の提案（層構造、責務境界）をADRに記載する
- [ ] 実際のコード統合は本PBIのスコープ外とし、後続PBIとして別途起票する

## テスト戦略

このPBIはドキュメント作成が主目的のため、新規テストは不要。既存の `domainFilter` 関連テストが変更されないことを確認する。

## 実装アプローチ

1. 8ファイルそれぞれを読み、役割（UI/ロジック/キャッシュ/CSP/パイプライン統合）を分類
2. simple形式とuBlock形式のコードパスの重複・分岐点を洗い出す
3. レイヤー図・ファイル対応表をADRとしてまとめる
4. 統合が必要な箇所があれば後続PBIとして起票する

## 見積もり

3pt（8ファイルの詳細分析 + ADR作成）

## 技術的考慮事項
- 依存関係: なし（分析フェーズ）
- 非機能要件: 保守性

## Definition of Done
- [ ] ADRが `dev-docs/ADR/` に作成されている
- [ ] 責務の一覧表とレイヤー図が含まれている
- [ ] 後続の統合PBIが必要な場合は起票されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（System Architect指摘、「ドメインフィルタ設定の肥大化」Low項目と統合）
- 対象コード: `src/popup/domainFilter.ts`, `src/utils/domainUtils.ts`, `src/utils/ublockMatcher.ts`, `src/utils/cspDomains.ts`, `src/utils/storage/domainFilterCache.ts`, `src/dashboard/domainFilterTagUI.ts`, `src/dashboard/panels/staticForm/domainFilterPanel.ts`, `src/background/pipeline/steps/checkDomainFilterStep.ts`
