# PBI 03: CWS 公開ステップ信頼性向上 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome Web Store公開ステップの信頼性を向上させる（Python構文エラー修正、IN_PROGRESSポーリング、curlタイムアウト追加）

**Architecture:** 複数の問題を段階的に修正: (1) Pythonスクリプトの`\n`エスケープ問題を修正、(2) uploadStateのポーリングロジックを追加、(3) curlコマンドにタイムアウトを追加

**Tech Stack:** GitHub Actions, Bash, Python3, curl

---

## タスク概要

1. **Task 1: Python構文エラー修正** - `\n`エスケープ問題を解決
2. **Task 2: IN_PROGRESSポーリング追加** - upload完了を待機
3. **Task 3: curlタイムアウト追加** - ネットワークハング対策
4. **Task 4: 検証** - 全修正が正しく動作することを確認

---

### Task 1: Python構文エラー修正

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 問題のあるPythonスクリプトを確認**

Run:
```bash
grep -n 'python3 -c' .github/workflows/release.yml
```

Expected output shows lines with `\n` in Python code:
```
110:            echo "${UPLOAD_RESP}" | python3 -c "import sys, json;\nfor e in json.load(sys.stdin).get('itemError', []):\n    print(e.get('error_code', '?'), e.get('error_detail', ''))"
119:          PUBLISH_STATUS=$(echo "${PUBLISH_RESP}" | python3 -c "import sys, json;\nd = json.load(sys.stdin);\ns = d.get('status', []);\nif isinstance(s, list) and len(s) > 0:\n    print(s[0])\nelif isinstance(s, str):\n    print(s)\nelse:\n    print('UNKNOWN')")
```

- [ ] **Step 2: Line 110のPythonスクリプトを修正**

現在のコード:
```bash
echo "${UPLOAD_RESP}" | python3 -c "import sys, json;\nfor e in json.load(sys.stdin).get('itemError', []):\n    print(e.get('error_code', '?'), e.get('error_detail', ''))"
```

修正後（リスト内包表記を使用）:
```bash
echo "${UPLOAD_RESP}" | python3 -c "import sys, json; [print(e.get('error_code', '?'), e.get('error_detail', '')) for e in json.load(sys.stdin).get('itemError', [])]"
```

- [ ] **Step 3: Line 119のPythonスクリプトを修正**

現在のコード:
```bash
PUBLISH_STATUS=$(echo "${PUBLISH_RESP}" | python3 -c "import sys, json;\nd = json.load(sys.stdin);\ns = d.get('status', []);\nif isinstance(s, list) and len(s) > 0:\n    print(s[0])\nelif isinstance(s, str):\n    print(s)\nelse:\n    print('UNKNOWN')")
```

修正後（三項演算子を使用）:
```bash
PUBLISH_STATUS=$(echo "${PUBLISH_RESP}" | python3 -c "import sys, json; d = json.load(sys.stdin); s = d.get('status', []); print(s[0] if isinstance(s, list) and len(s) > 0 else (s if isinstance(s, str) else 'UNKNOWN'))")
```

- [ ] **Step 4: Commit Python syntax fixes**

```bash
git add .github/workflows/release.yml
git commit -m "fix(ci): fix Python syntax errors in CWS publish step"
```

---

### Task 2: IN_PROGRESSポーリング追加

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: upload後のポーリングロジックを追加**

現在のコード（Line 106-112）:
```bash
          UPLOAD_STATUS=$(echo "${UPLOAD_RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('uploadState','UNKNOWN'))")
          echo "Upload: ${UPLOAD_STATUS}"
          if [ "${UPLOAD_STATUS}" != "SUCCESS" ] && [ "${UPLOAD_STATUS}" != "IN_PROGRESS" ]; then
            echo "Error detail:"
            echo "${UPLOAD_RESP}" | python3 -c "import sys, json; [print(e.get('error_code', '?'), e.get('error_detail', '')) for e in json.load(sys.stdin).get('itemError', [])]"
            exit 1
          fi
```

修正後（ポーリングループを追加）:
```bash
          UPLOAD_STATUS=$(echo "${UPLOAD_RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('uploadState','UNKNOWN'))")
          echo "Upload: ${UPLOAD_STATUS}"
          
          # Poll until upload is complete (max 5 minutes)
          if [ "${UPLOAD_STATUS}" = "IN_PROGRESS" ]; then
            for i in {1..30}; do
              sleep 10
              STATUS_RESP=$(curl -s -X GET \
                "https://www.googleapis.com/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}" \
                -H "Authorization: Bearer ${ACCESS_TOKEN}")
              UPLOAD_STATUS=$(echo "${STATUS_RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('uploadState','UNKNOWN'))")
              echo "Upload status check ${i}/30: ${UPLOAD_STATUS}"
              if [ "${UPLOAD_STATUS}" != "IN_PROGRESS" ]; then
                break
              fi
            done
          fi
          
          if [ "${UPLOAD_STATUS}" != "SUCCESS" ]; then
            echo "Upload failed with status: ${UPLOAD_STATUS}"
            echo "Error detail:"
            echo "${UPLOAD_RESP}" | python3 -c "import sys, json; [print(e.get('error_code', '?'), e.get('error_detail', '')) for e in json.load(sys.stdin).get('itemError', [])]"
            exit 1
          fi
```

- [ ] **Step 2: Commit polling logic**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): add polling for IN_PROGRESS upload state in CWS publish"
```

---

### Task 3: curlタイムアウト追加

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 全curlコマンドにタイムアウトを追加**

OAuth token取得（Line 91-92）:
```bash
# Before
FULL_RESP=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${CHROME_CLIENT_ID}&client_secret=${CHROME_CLIENT_SECRET}&refresh_token=${CHROME_REFRESH_TOKEN}&grant_type=refresh_token")

# After
FULL_RESP=$(curl -s --connect-timeout 10 --max-time 30 -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${CHROME_CLIENT_ID}&client_secret=${CHROME_CLIENT_SECRET}&refresh_token=${CHROME_REFRESH_TOKEN}&grant_type=refresh_token")
```

Upload（Line 102-105）:
```bash
# Before
UPLOAD_RESP=$(curl -s -X PUT \
  "https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/zip" \
  --data-binary "@${ZIP_FILE}")

# After
UPLOAD_RESP=$(curl -s --connect-timeout 10 --max-time 300 -X PUT \
  "https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/zip" \
  --data-binary "@${ZIP_FILE}")
```

Status check（Task 2で追加）:
```bash
# Before
STATUS_RESP=$(curl -s -X GET \
  "https://www.googleapis.com/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

# After
STATUS_RESP=$(curl -s --connect-timeout 10 --max-time 30 -X GET \
  "https://www.googleapis.com/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")
```

Publish（Line 114-117）:
```bash
# Before
PUBLISH_RESP=$(curl -s -X POST \
  "https://www.googleapis.com/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}/publish" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Length: 0")

# After
PUBLISH_RESP=$(curl -s --connect-timeout 10 --max-time 60 -X POST \
  "https://www.googleapis.com/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}/publish" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Length: 0")
```

- [ ] **Step 2: Commit timeout additions**

```bash
git add .github/workflows/release.yml
git commit -m "fix(ci): add timeouts to all curl commands in CWS publish step"
```

---

### Task 4: 検証 - 全修正が正しく動作することを確認

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
# Test line 110 fix
echo '{"itemError": [{"error_code": "400", "error_detail": "bad"}]}' | python3 -c "import sys, json; [print(e.get('error_code', '?'), e.get('error_detail', '')) for e in json.load(sys.stdin).get('itemError', [])]"

# Test line 119 fix
echo '{"status": ["OK"]}' | python3 -c "import sys, json; d = json.load(sys.stdin); s = d.get('status', []); print(s[0] if isinstance(s, list) and len(s) > 0 else (s if isinstance(s, str) else 'UNKNOWN'))"
echo '{"status": "IN_REVIEW"}' | python3 -c "import sys, json; d = json.load(sys.stdin); s = d.get('status', []); print(s[0] if isinstance(s, list) and len(s) > 0 else (s if isinstance(s, str) else 'UNKNOWN'))"
echo '{"status": []}' | python3 -c "import sys, json; d = json.load(sys.stdin); s = d.get('status', []); print(s[0] if isinstance(s, list) and len(s) > 0 else (s if isinstance(s, str) else 'UNKNOWN'))"
```

Expected:
```
400 bad
OK
IN_REVIEW
UNKNOWN
```

- [ ] **Step 3: curlタイムアウトが設定されていることを確認**

Run:
```bash
grep -n "curl.*--connect-timeout\|curl.*--max-time" .github/workflows/release.yml
```

Expected: All curl commands should have timeout options

- [ ] **Step 4: Final commit**

```bash
git add .github/workflows/release.yml
git commit -m "test(ci): verify all CWS publish reliability fixes"
```

---

## 実装計画の完了

実装計画を`docs/superpowers/plans/2026-07-25-pbi-03-cws-publish-reliability.md`に保存しました。
