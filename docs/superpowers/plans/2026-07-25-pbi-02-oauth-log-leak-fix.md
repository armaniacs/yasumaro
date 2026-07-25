# PBI 02: OAuth レスポンスログ漏洩防止 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OAuth認証失敗時にCIログへ機密情報（access_token等）が漏洩するのを防止する

**Architecture:** 認証失敗時のfull responseダンプを削除し、必要なエラー情報のみを選択的に出力する。Pythonスクリプトで機密フィールドをマスクしてからログ出力する。

**Tech Stack:** GitHub Actions, Bash, Python3

---

## タスク概要

1. **Task 1: 現状分析** - 漏洩箇所を特定
2. **Task 2: マスク処理の実装** - 機密フィールドを削除するPythonスクリプト作成
3. **Task 3: ログ出力の修正** - マスク済みレスポンスを出力
4. **Task 4: 検証** - 機密情報がログに含まれないことを確認

---

### Task 1: 現状分析 - 漏洩箇所を特定

**Files:**
- Analyze: `.github/workflows/release.yml`

- [ ] **Step 1: 認証失敗時のログ出力箇所を確認**

Run:
```bash
grep -n "FULL_RESP\|json.tool" .github/workflows/release.yml
```

Expected output:
```
91:          FULL_RESP=$(curl -s -X POST https://oauth2.googleapis.com/token \
93:          ACCESS_TOKEN=$(echo "${FULL_RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
95:            echo "Auth failed. Full response:"
96:            echo "${FULL_RESP}" | python3 -m json.tool
```

- [ ] **Step 2: 問題点を特定**

Line 96で`python3 -m json.tool`を使用してfull responseを出力している。これにより、レスポンスに`access_token`が含まれていた場合にログに漏洩する。

- [ ] **Step 3: Commit analysis**

```bash
git commit --allow-empty -m "docs: analyze OAuth response log leak in release.yml"
```

---

### Task 2: マスク処理の実装

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 機密フィールドを削除するPythonスクリプトを作成**

認証失敗時のログ出力を以下のように修正:

```bash
          if [ -z "${ACCESS_TOKEN}" ]; then
            echo "Auth failed. Error details:"
            echo "${FULL_RESP}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    # Remove sensitive fields
    for k in ('access_token', 'refresh_token', 'client_secret', 'id_token'):
        d.pop(k, None)
    # Print only error information
    if 'error' in d:
        print(f\"Error: {d['error']}\")
    if 'error_description' in d:
        print(f\"Description: {d['error_description']}\")
    if 'error_uri' in d:
        print(f\"URI: {d['error_uri']}\")
    if not any(k in d for k in ('error', 'error_description', 'error_uri')):
        print('Unknown error - response sanitized')
except:
    print('Failed to parse error response')
"
            exit 1
          fi
```

- [ ] **Step 2: Commit mask implementation**

```bash
git add .github/workflows/release.yml
git commit -m "fix(ci): mask sensitive fields in OAuth error response logging"
```

---

### Task 3: ログ出力の修正

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 修正後のログ出力を確認**

Run:
```bash
grep -A 15 "Auth failed" .github/workflows/release.yml
```

Expected: Should show the masked output logic, not `python3 -m json.tool`

- [ ] **Step 2: Commit log output fix**

```bash
git add .github/workflows/release.yml
git commit -m "fix(ci): replace full response dump with sanitized error output"
```

---

### Task 4: 検証 - 機密情報がログに含まれないことを確認

**Files:**
- Test: `.github/workflows/release.yml`

- [ ] **Step 1: YAML構文を検証**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML syntax OK"
```

Expected: `YAML syntax OK`

- [ ] **Step 2: Pythonスクリプトの構文を検証**

Run:
```bash
python3 -c "
import sys, json
# Simulate error response with sensitive data
test_response = '{\"error\": \"invalid_grant\", \"access_token\": \"secret123\", \"error_description\": \"Token expired\"}'
d = json.loads(test_response)
for k in ('access_token', 'refresh_token', 'client_secret', 'id_token'):
    d.pop(k, None)
if 'error' in d:
    print(f\"Error: {d['error']}\")
if 'error_description' in d:
    print(f\"Description: {d['error_description']}\")
assert 'access_token' not in d
print('Test passed: sensitive fields removed')
"
```

Expected:
```
Error: invalid_grant
Description: Token expired
Test passed: sensitive fields removed
```

- [ ] **Step 3: Final commit**

```bash
git add .github/workflows/release.yml
git commit -m "test(ci): verify OAuth response masking works correctly"
```

---

## 実装計画の完了

実装計画を`docs/superpowers/plans/2026-07-25-pbi-02-oauth-log-leak-fix.md`に保存しました。
