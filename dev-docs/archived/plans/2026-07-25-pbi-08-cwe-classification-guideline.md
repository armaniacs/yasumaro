# PBI 08: セキュリティ脆弱性分類フレームワーク（CWE）の設計時適用 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セキュリティ関連の機能・修正を設計する際にCWE（Common Weakness Enumeration）で分類するプロセスを確立する

**Architecture:** 過去のセキュリティインシデントをCWEで分類し、設計時の適用プロセスを文書化。ADRへの記録方法を規定。

**Tech Stack:** Markdown, CWE

---

## タスク概要

1. **Task 1: インシデント分析** - 過去のセキュリティインシデントをCWEで分類
2. **Task 2: ガイドライン作成** - CWE分類プロセスを文書化
3. **Task 3: 既存ADRへの適用** - サンプル適用を作成
4. **Task 4: 検証** - ガイドラインの完全性を確認

---

### Task 1: インシデント分析

**Files:**
- Analyze: `CHANGELOG.md` (セキュリティ修正の履歴)
- Analyze: `dev-docs/ADR/` (既存のADR)

- [ ] **Step 1: 過去のセキュリティインシデントをリスト化**

CHANGELOGからセキュリティ関連の修正を抽出:
- マークダウン注入（VULN-001,002,004,005）
- 設定インポート署名検証バイパス（VULN-009,010）
- ループバックSSRF（VULN-013）
- PBKDF2反復回数強化（VULN-019）
- Stored XSS（v6.5.46）
- コマンドインジェクション（PBI 01）
- ログ漏洩（PBI 02）

- [ ] **Step 2: 各インシデントをCWEで分類**

| インシデント | CWE ID | CWE名称 |
|------------|--------|---------|
| マークダウン注入 | CWE-79 | Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting') |
| Stored XSS | CWE-79 | 同上 |
| コマンドインジェクション | CWE-94 | Improper Control of Generation of Code ('Code Injection') |
| SSRF | CWE-918 | Server-Side Request Forgery (SSRF) |
| ログ漏洩 | CWE-200 | Exposure of Sensitive Information to an Unauthorized Actor |
| 署名検証バイパス | CWE-347 | Improper Verification of Cryptographic Signature |
| PBKDF2反復数不足 | CWE-916 | Use of Password Hash With Insufficient Computational Effort |
| パストラバーサル | CWE-22 | Improper Limitation of a Pathname to a Restricted Directory |
| DoS（リソース枯渇） | CWE-400 | Uncontrolled Resource Consumption |

- [ ] **Step 3: Commit analysis**

```bash
git commit --allow-empty -m "docs: analyze past security incidents with CWE classification"
```

---

### Task 2: ガイドライン作成

**Files:**
- Create: `docs/CWE_CLASSIFICATION_GUIDELINE.md`

- [ ] **Step 1: ガイドラインの骨格を作成**

```markdown
# CWE Classification Guidelines

セキュリティ関連の機能・修正を設計する際にCWE（Common Weakness Enumeration）で分類するガイドライン。

## CWEとは

CWE（Common Weakness Enumeration）は、ソフトウェアセキュリティ脆弱性の分類体系。MITREによって管理され、各脆弱性タイプに一意のIDが割り当てられている。

参考: https://cwe.mitre.org/

## このプロジェクトで関連する主要CWE

### 注入系
- **CWE-79**: Cross-site Scripting (XSS)
  - 例: マークダウン注入、Stored XSS
  - 対策: 出力のエスケープ、サニタイゼーション
  
- **CWE-94**: Code Injection
  - 例: コマンドインジェクション
  - 対策: 入力検証、安全なAPI使用
  
- **CWE-89**: SQL Injection
  - 例: SQLインジェクション
  - 対策: パラメータ化クエリ

### 認証・認可系
- **CWE-287**: Improper Authentication
  - 例: 認証バイパス
  - 対策: 適切な認証フロー
  
- **CWE-862**: Missing Authorization
  - 例: 認可チェック欠如
  - 対策: 権限検証
  
- **CWE-347**: Improper Verification of Cryptographic Signature
  - 例: 署名検証バイパス
  - 対策: 適切な署名検証

### 情報漏洩系
- **CWE-200**: Exposure of Sensitive Information
  - 例: ログ漏洩
  - 対策: 機密情報のマスク
  
- **CWE-209**: Information Exposure Through an Error Message
  - 例: エラーメッセージからの情報漏洩
  - 対策: 汎用エラーメッセージ

### ネットワーク系
- **CWE-918**: Server-Side Request Forgery (SSRF)
  - 例: ループバックSSRF
  - 対策: URL検証、許可リスト
  
- **CWE-22**: Path Traversal
  - 例: ディレクトリトラバーサル
  - 対策: パス検証

### リソース管理系
- **CWE-400**: Uncontrolled Resource Consumption
  - 例: DoS
  - 対策: リソース制限、タイムアウト
  
- **CWE-916**: Use of Password Hash With Insufficient Computational Effort
  - 例: PBKDF2反復数不足
  - 対策: 十分な反復回数

## 設計時の適用プロセス

### 1. 脆弱性の特定
新機能・修正を設計する際、以下の質問に答える:
- 外部からの入力は何か？
- その入力はどこで使用されるか？
- 適切に検証・エスケープされているか？
- 認証・認可は適切か？
- 機密情報は適切に扱われているか？

### 2. CWE分類
特定した脆弱性をCWEで分類:
1. CWE公式サイトで関連するCWEを検索
2. 最も適切なCWE IDを選択
3. 複数のCWEが関わる場合は全て記録

### 3. ADRへの記録
セキュリティ関連のADRには以下のセクションを追加:

```markdown
## Security Considerations

### CWE Classification
- **CWE-79**: Cross-site Scripting
  - 影響: ユーザーがマークダウンを介してスクリプトを実行可能
  - 対策: `sanitizeForObsidian()`によるサニタイゼーション

### Trade-offs
- 安全性 vs 機能性: サニタイゼーションにより一部のマークダウン機能が制限される
```

### 4. 複数CWEの分離基準
1つの修正が複数のCWEに関わる場合:
- 各CWEが独立した懸念事項の場合はADRを分離
- 密接に関連する場合は同一ADR内でセクションを分ける

例:
- マークダウンサニタイズ（CWE-79）とレスポンスサイズ制限（CWE-400）は独立 → ADR分離
- XSS防止のための複数のサニタイゼーション手法は関連 → 同一ADR内

## 既存のセキュリティ修正のCWE分類例

### VULN-001,002,004,005: マークダウン注入
- **CWE-79**: Cross-site Scripting
- 影響: Obsidianにマークダウンを介してスクリプトを注入可能
- 対策: `sanitizeForObsidian()`、`sanitizeUrlForMarkdownTarget()`

### VULN-009,010: 設定インポート署名検証バイパス
- **CWE-347**: Improper Verification of Cryptographic Signature
- 影響: 署名検証をバイパスして悪意ある設定をインポート可能
- 対策: 署名検証失敗時は常にインポートを拒否

### VULN-013: ループバックSSRF
- **CWE-918**: Server-Side Request Forgery (SSRF)
- 影響: ループバックアドレスへのリクエストで内部サービスにアクセス可能
- 対策: ポート許可リスト、IPv4正規表現の完全アンカー化

### PBI 01: コマンドインジェクション
- **CWE-94**: Code Injection
- 影響: CIパイプラインで任意コード実行可能
- 対策: env変数経由での安全な展開

### PBI 02: ログ漏洩
- **CWE-200**: Exposure of Sensitive Information
- 影響: CIログから機密情報が漏洩
- 対策: 機密フィールドのマスク
```

- [ ] **Step 2: Commit guideline creation**

```bash
git add docs/CWE_CLASSIFICATION_GUIDELINE.md
git commit -m "docs: create CWE classification guidelines for security design"
```

---

### Task 3: 既存ADRへの適用

**Files:**
- Modify: `dev-docs/ADR/2026-07-22-markdown-output-sanitization-guardrail.md`

- [ ] **Step 1: 既存ADRを確認**

Run:
```bash
cat dev-docs/ADR/2026-07-22-markdown-output-sanitization-guardrail.md
```

- [ ] **Step 2: CWE分類セクションを追加**

ADRの末尾に以下を追加:

```markdown
## Security Considerations

### CWE Classification
- **CWE-79**: Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')
  - 影響: ユーザーがマークダウンを介してObsidianでスクリプトを実行可能
  - 対策: `sanitizeForObsidian()`によるリンクのサニタイゼーション、`escapeObsidianWikilinks()`によるWikiLinkのエスケープ

### Related CVEs
- なし（潜在的な脆弱性を未然に防止）

### Trade-offs
- 安全性 vs 機能性: サニタイゼーションにより一部のマークダウン機能が制限される
  - 例: `javascript:`スキームのリンクはブロックされる
```

- [ ] **Step 3: Commit ADR update**

```bash
git add dev-docs/ADR/
git commit -m "docs(adr): add CWE classification to markdown sanitization ADR"
```

---

### Task 4: 検証

**Files:**
- Test: `docs/CWE_CLASSIFICATION_GUIDELINE.md`

- [ ] **Step 1: ガイドラインの完全性を確認**

Run:
```bash
cat docs/CWE_CLASSIFICATION_GUIDELINE.md | grep -c "^###"
```

Expected: At least 10 CWE categories

- [ ] **Step 2: CWE IDの正確性を確認**

Run:
```bash
grep -o "CWE-[0-9]*" docs/CWE_CLASSIFICATION_GUIDELINE.md | sort -u
```

Expected: List of valid CWE IDs

- [ ] **Step 3: Final commit**

```bash
git commit --allow-empty -m "test: verify CWE classification guidelines completeness"
```

---

## 実装計画の完了

実装計画を`docs/superpowers/plans/2026-07-25-pbi-08-cwe-classification-guideline.md`に保存しました。
