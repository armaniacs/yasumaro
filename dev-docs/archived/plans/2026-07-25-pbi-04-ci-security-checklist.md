# PBI 04: CI/CDセキュリティレビューチェックリスト作成 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CI/CDパイプラインのセキュリティレビュー用チェックリストを作成する

**Architecture:** 過去のインシデントからチェック項目を抽出し、Markdown形式のチェックリストを作成。PRテンプレートに参照を追加。

**Tech Stack:** Markdown, GitHub Actions

---

## タスク概要

1. **Task 1: インシデント分析** - 過去のセキュリティインシデントを洗い出し
2. **Task 2: チェックリスト作成** - Markdown形式でチェックリストを作成
3. **Task 3: PRテンプレート更新** - チェックリストへの参照を追加
4. **Task 4: 検証** - 既存ワークフローでチェックリストを適用

---

### Task 1: インシデント分析

**Files:**
- Analyze: `pbi/2026-07-25-01-fix-release-command-injection.md`
- Analyze: `pbi/2026-07-25-02-fix-oauth-response-log-leak.md`
- Analyze: `docs/superpowers/plans/2026-07-25-pbi-01-command-injection-fix.md`

- [ ] **Step 1: 過去のインシデントをリスト化**

以下のインシデントからチェック項目を抽出:
1. コマンドインジェクション（`${{ }}`式の直接展開）
2. ログ漏洩（OAuthレスポンスのfull dump）
3. タイムアウト欠如（curlコマンド）
4. Python構文エラー（`\n`エスケープ問題）
5. IN_PROGRESSポーリング欠如

- [ ] **Step 2: チェック項目を分類**

カテゴリ:
- シェルインジェクション防止
- シークレット管理
- ネットワーク信頼性
- エラーハンドリング
- 入力検証

- [ ] **Step 3: Commit analysis**

```bash
git commit --allow-empty -m "docs: analyze past CI/CD security incidents"
```

---

### Task 2: チェックリスト作成

**Files:**
- Create: `docs/CI_SECURITY_CHECKLIST.md`

- [ ] **Step 1: チェックリストの骨格を作成**

```markdown
# CI/CD Security Checklist

GitHub Actionsワークフローをレビューする際のチェックリスト。

## シェルインジェクション防止

- [ ] `${{ }}`式を`run:`ブロックで直接使用していない
  - ❌ `run: echo ${{ steps.version.outputs.version }}`
  - ✅ `env: VERSION: ${{ steps.version.outputs.version }}` + `run: echo "${VERSION}"`
- [ ] 外部入力（version、branch名等）を二重引用符で囲んでいる
- [ ] シェルメタ文字（`;`, `|`, `&`, `$`）を含む可能性のある入力を検証している

## シークレット管理

- [ ] シークレットをログに出力していない
  - ❌ `echo "${SECRET}"`
  - ✅ `echo "::add-mask::${SECRET}"` または出力しない
- [ ] エラーレスポンスのfull dumpを出力していない
- [ ] 機密情報はマスクしてからログ出力

## ネットワーク信頼性

- [ ] `curl`コマンドに`--connect-timeout`と`--max-time`を設定
- [ ] 外部API呼び出しにリトライロジックを実装
- [ ] タイムアウト時のエラーメッセージを明確化

## エラーハンドリング

- [ ] 非同期処理の完了をポーリングで確認
- [ ] エラー時の詳細情報を出力（機密情報を除く）
- [ ] 予期しない状態に対するフォールバック処理

## 入力検証

- [ ] バージョン文字列がsemver形式であることを検証
- [ ] ファイルパスにディレクトリトラバーサルが含まれていないことを確認
- [ ] 外部からの入力サイズに上限を設定
```

- [ ] **Step 2: 各項目に具体例を追加**

各チェック項目に対して:
- 「なぜ危険か」の説明
- 「どう修正するか」のコード例
- 関連するインシデントへの参照

- [ ] **Step 3: Commit checklist creation**

```bash
git add docs/CI_SECURITY_CHECKLIST.md
git commit -m "docs: create CI/CD security review checklist"
```

---

### Task 3: PRテンプレート更新

**Files:**
- Modify: `.github/PULL_REQUEST_TEMPLATE.md` (存在しない場合は作成)

- [ ] **Step 1: PRテンプレートを確認**

Run:
```bash
ls -la .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null || echo "File not found"
```

- [ ] **Step 2: チェックリストへの参照を追加**

PRテンプレートに以下を追加:

```markdown
## CI/CD Security

If this PR modifies `.github/workflows/`, please review the [CI/CD Security Checklist](../docs/CI_SECURITY_CHECKLIST.md).

- [ ] No direct `${{ }}` expansion in `run:` blocks
- [ ] Secrets are not logged
- [ ] Network calls have timeouts
```

- [ ] **Step 3: Commit PR template update**

```bash
git add .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: add CI/CD security checklist reference to PR template"
```

---

### Task 4: 検証

**Files:**
- Test: `.github/workflows/release.yml`
- Test: `docs/CI_SECURITY_CHECKLIST.md`

- [ ] **Step 1: 既存ワークフローをチェックリストで監査**

Run:
```bash
# Check for direct ${{ }} expansion in run blocks
grep -n 'run:.*\${{' .github/workflows/release.yml

# Check for secrets in logs
grep -n 'echo.*SECRET\|echo.*KEY\|echo.*TOKEN' .github/workflows/release.yml

# Check for curl without timeouts
grep -n 'curl' .github/workflows/release.yml | grep -v 'connect-timeout\|max-time'
```

Expected: All checks should pass (no output or only safe patterns)

- [ ] **Step 2: チェックリストの完全性を確認**

Run:
```bash
cat docs/CI_SECURITY_CHECKLIST.md | grep -c '^\- \['
```

Expected: At least 15 checklist items

- [ ] **Step 3: Final commit**

```bash
git commit --allow-empty -m "test: verify CI/CD security checklist completeness"
```

---

## 実装計画の完了

実装計画を`docs/superpowers/plans/2026-07-25-pbi-04-ci-security-checklist.md`に保存しました。
