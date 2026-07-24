# PBI: セキュリティ脆弱性分類フレームワーク（CWE）の設計時適用

## ユーザーストーリー

開発者として、新機能・修正を設計する際に、セキュリティ脆弱性をCWE（Common Weakness Enumeration）で分類するプロセスがほしい。なぜなら、脆弱性の性質を体系的に理解せず、ADRや実装が不適切になるリスクがあるから。

## ビジネス価値

- セキュリティ脆弱性の性質を正確に理解
- 適切な修正アプローチの選択
- ADRやドキュメントのトレーサビリティ向上

## BDD受け入れシナリオ

```gherkin
Scenario: 開発者がセキュリティ関連の機能を実装する際にCWE分類が参照される
  Given 開発者がセキュリティ関連の新機能・修正を設計する
  When 設計レビューが行われる
  Then CWE分類に基づいて脆弱性の性質が明確化される
  And 適切な修正アプローチが選択される

Scenario: ADR作成時にCWE分類が記録される
  Given セキュリティ関連のADRが作成される
  When ADRが執筆される
  Then 対象となるCWE IDが明記される
  And 複数のCWEが関わる場合は適切に分離される
```

## 受け入れ基準

- [ ] `docs/CWE_CLASSIFICATION_GUIDELINE.md` が作成されている
- [ ] 以下の項目が定義されている:
  - [ ] **CWE基本概念**: CWEとは何か、なぜ分類が必要か
  - [ ] **主要CWE一覧**: このプロジェクトで関連するCWE IDとその説明
    - CWE-79 (XSS)
    - CWE-94 (Code Injection)
    - CWE-200 (Information Exposure)
    - CWE-400 (Uncontrolled Resource Consumption)
    - CWE-611 (XXE)
    - CWE-862 (Missing Authorization)
    - 等
  - [ ] **設計時の適用プロセス**: どのようにCWEを特定・分類するか
  - [ ] **ADRへの記録方法**: CWE IDをADRにどう記録するか
  - [ ] **複数CWEの分離基準**: 1つの修正が複数のCWEに関わる場合の分離ルール
- [ ] 既存のセキュリティ修正（VulnHunter対応等）のCWE分類例が含まれている

## テスト戦略（t_wadaスタイル）

### ドキュメントレビュー
- セキュリティ専門家がガイドラインをレビュー
- 既存のインシデントがCWE分類で適切に分類可能か検証

### 実装検証
- 既存のADRにCWE分類を追加する演習
- 新規セキュリティ修正でCWE分類を適用

## 実装アプローチ

- **Outside-In**: 過去のセキュリティインシデントからCWE分類を逆算
- **Red-Green-Refactor**: ガイドラインを実際のADR作成に適用してみて、不足項目を追加

## 見積もり

🟡中（2pt）

## 技術的考慮事項

- 作成場所: `docs/CWE_CLASSIFICATION_GUIDELINE.md`
- 参照: CWE公式サイト (https://cwe.mitre.org/)
- 既存のADR（`dev-docs/ADR/`）への適用

## 実装者向け注記

### 実装手順
1. 過去のセキュリティインシデント（VulnHunter対応等）を洗い出す
2. 各インシデントをCWEで分類
3. このプロジェクトで関連するCWE一覧を作成
4. 設計時の適用プロセスを定義
5. ADRへの記録方法を定義
6. ガイドラインをMarkdown形式で作成

### 落とし穴
- CWE分類にこだわりすぎて実装が遅れる
- CWEの粒度が粗すぎると効果が薄い
- チームメンバーがCWEに慣れていないと浸透しない

## Definition of Done

- [ ] ガイドラインが作成され、チームに共有されている
- [ ] 既存のADR至少くとも1つにCWE分類を追加
- [ ] チームメンバーがガイドラインを理解し、使用できる

## 関連PBI

- 2026-07-22-01-doc-response-size-limit-adr（このPBIで発見された問題）
