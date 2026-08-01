# PBI 01: release.yml コマンドインジェクション修正 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `${{ steps.version.outputs.version }}` の直接展開によるコマンドインジェクション脆弱性を修正する

**Architecture:** GitHub Actionsの式展開（`${{ }}`）はシェルパース前に実行されるため、変数値にシェルメタ文字が含まれているとインジェクションが発生する。これを防ぐため、`env:` セクションで変数を定義し、シェル内では`${VERSION}`のように二重引用符で囲んで展開する。

**Tech Stack:** GitHub Actions, Bash, YAML

---

## タスク概要

1. **Task 1: 現状分析** - 脆弱な展開箇所を特定
2. **Task 2: env変数セクションの追加** - version抽出ステップの改善
3. **Task 3: Release assetsの安全な展開** - Create Releaseステップの確認
4. **Task 4: Chrome Web Store publishステップの安全な展開** - VERSION env変数の追加
5. **Task 5: 検証** - コマンドインジェクションが修正されたことを確認
6. **Task 6: ドキュメント更新** - PBI 04に委ねる

---

## 詳細タスク

### Task 1: 現状分析 - 脆弱な展開箇所を特定

**Files:**
- Analyze: `.github/workflows/release.yml`

- [ ] **Step 1: release.yml内の`${{ }}`展開箇所を列挙**

Run:
```bash
grep -n '\${{.*}}' .github/workflows/release.yml
```

- [ ] **Step 2: 危険な展開箇所を特定**

以下のパターンが危険：
- `run:` ブロック内で `${{ steps.version.outputs.version }}` を直接使用
- `run:` ブロック内で `${{ secrets.* }}` を直接使用
- 二重引用符で囲まれていない展開

安全なパターン：
- `env:` セクションで定義した変数を `${VAR}` で展開
- 常に二重引用符で囲む `"${VAR}"`

- [ ] **Step 3: 修正が必要な箇所をリスト化**

修正が必要な箇所：
1. Line 39: `MINOR=$(echo "${{ steps.version.outputs.version }}" | cut -d. -f2)`
2. Line 56: `dist/yasumaro-${{ steps.version.outputs.version }}-chrome.zip`
3. Line 58: `dist/yasumaro-${{ steps.version.outputs.version }}-chrome.crx`
4. Line 76-79: Release assets paths
5. Line 100: `ZIP_FILE="dist/yasumaro-${{ steps.version.outputs.version }}-chrome.zip"`
6. Line 103, 104, 115, 116: secrets and env vars in curl commands

- [ ] **Step 4: Commit analysis**

```bash
git add .github/workflows/release.yml
git commit -m "docs: analyze command injection vulnerabilities in release.yml"
```

---

### Task 2: env変数セクションの追加

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: "Extract version"ステップにminor変数を追加**

現在のコード（Line 31-36）:
```yaml
      - name: Extract version
        id: version
        run: |
          VERSION=$(node -p "require('./package.json').version")
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "Extracted version: $VERSION"
```

修正後:
```yaml
      - name: Extract version
        id: version
        run: |
          VERSION=$(node -p "require('./package.json').version")
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "minor=$(echo "$VERSION" | cut -d. -f2)" >> $GITHUB_OUTPUT
          echo "Extracted version: $VERSION"
```

- [ ] **Step 2: "Check if minor version is even"ステップを簡素化**

現在のコード（Line 37-46）:
```yaml
      - name: Check if minor version is even
        id: minor_check
        run: |
          MINOR=$(echo "${{ steps.version.outputs.version }}" | cut -d. -f2)
          if [ $((MINOR % 2)) -eq 0 ]; then
            echo "is_even=true" >> $GITHUB_OUTPUT
          else
            echo "is_even=false" >> $GITHUB_OUTPUT
          fi
          echo "Minor version: $MINOR (even: $((MINOR % 2 == 0)))"
```

修正後:
```yaml
      - name: Check if minor version is even
        id: minor_check
        run: |
          MINOR="${{ steps.version.outputs.minor }}"
          if [ $((MINOR % 2)) -eq 0 ]; then
            echo "is_even=true" >> $GITHUB_OUTPUT
          else
            echo "is_even=false" >> $GITHUB_OUTPUT
          fi
          echo "Minor version: $MINOR (even: $((MINOR % 2 == 0)))"
```

- [ ] **Step 3: "Sign CRX with private key"ステップにenv変数を追加**

現在のコード（Line 50-59）:
```yaml
      - name: Sign CRX with private key
        env:
          CRX_PRIVATE_KEY: ${{ secrets.CRX_PRIVATE_KEY }}
        run: |
          echo "${CRX_PRIVATE_KEY}" > /tmp/private.pem
          node .github/workflows/build-crx2.mjs \
            dist/yasumaro-${{ steps.version.outputs.version }}-chrome.zip \
            /tmp/private.pem \
            dist/yasumaro-${{ steps.version.outputs.version }}-chrome.crx
          rm /tmp/private.pem
```

修正後:
```yaml
      - name: Sign CRX with private key
        env:
          CRX_PRIVATE_KEY: ${{ secrets.CRX_PRIVATE_KEY }}
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          echo "${CRX_PRIVATE_KEY}" > /tmp/private.pem
          node .github/workflows/build-crx2.mjs \
            "dist/yasumaro-${VERSION}-chrome.zip" \
            /tmp/private.pem \
            "dist/yasumaro-${VERSION}-chrome.crx"
          rm /tmp/private.pem
```

- [ ] **Step 4: Commit env variable additions**

```bash
git add .github/workflows/release.yml
git commit -m "fix(ci): use env variables to prevent command injection in release.yml"
```

---

### Task 3: Release assetsの安全な展開

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: "Create Release"ステップを確認**

現在のコードは既に`env:`セクションで`VERSION`を定義し、JavaScript内で`process.env.VERSION`を使用しているため安全です。修正不要です。

- [ ] **Step 2: Verify no changes needed**

Run:
```bash
grep -A 20 "Create Release" .github/workflows/release.yml | grep -E '\$\{\{.*\}\}'
```

Expected: Only `secrets.GITHUB_TOKEN` should appear, which is safe in this context.

---

### Task 4: Chrome Web Store publishステップの安全な展開

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: "Publish to Chrome Web Store"ステップにenv変数を追加**

現在のコード（Line 83-122）の`env:`セクションに`VERSION`を追加し、`run:`ブロック内の`${{ steps.version.outputs.version }}`を`${VERSION}`に置き換えます。

修正後の`env:`セクション:
```yaml
        env:
          CHROME_EXTENSION_ID: ${{ secrets.CHROME_EXTENSION_ID }}
          CHROME_CLIENT_ID: ${{ secrets.CHROME_CLIENT_ID }}
          CHROME_CLIENT_SECRET: ${{ secrets.CHROME_CLIENT_SECRET }}
          CHROME_REFRESH_TOKEN: ${{ secrets.CHROME_REFRESH_TOKEN }}
          VERSION: ${{ steps.version.outputs.version }}
```

修正後の`ZIP_FILE`定義:
```bash
          ZIP_FILE="dist/yasumaro-${VERSION}-chrome.zip"
```

- [ ] **Step 2: Commit Chrome Web Store publish fix**

```bash
git add .github/workflows/release.yml
git commit -m "fix(ci): use env variable for VERSION in Chrome Web Store publish step"
```

---

### Task 5: 検証 - コマンドインジェクションが修正されたことを確認

**Files:**
- Test: `.github/workflows/release.yml`

- [ ] **Step 1: 修正後のrelease.ymlを確認**

Run:
```bash
grep -n '\${{.*}}' .github/workflows/release.yml | grep -v 'secrets\.' | grep -v 'env\.'
```

Expected: Only `steps.version.outputs.minor` should remain (which is safe as it's numeric only).

- [ ] **Step 2: YAML構文を検証**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML syntax OK"
```

Expected: `YAML syntax OK`

- [ ] **Step 3: マニフェストの整合性を確認**

Run:
```bash
node scripts/check-version-consistency.js
```

Expected: All versions match (6.6.2)

- [ ] **Step 4: Final commit**

```bash
git add .github/workflows/release.yml
git commit -m "test(ci): verify command injection fix in release.yml"
```

---

## 実装計画の完了

実装計画を`docs/superpowers/plans/2026-07-25-pbi-01-command-injection-fix.md`に保存しました。

**次のステップ:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
