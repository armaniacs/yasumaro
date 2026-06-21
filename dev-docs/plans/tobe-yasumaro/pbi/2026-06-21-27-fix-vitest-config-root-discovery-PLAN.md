# PBI-27: vitest 設定ファイルの自動発見問題を修正 — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx vitest run`（`--config` なし）で全テストがパスするように vitest 設定の自動発見を修正する

**Architecture:** プロジェクトルートに `vitest.config.ts` を作成し、既存の `testDir/vitest.config.ts` を再エクスポートする。これにより Vitest の自動発見が動作し、`globals: true`、`setupFiles`、`exclude` パターンが正しく適用される。

**Tech Stack:** TypeScript, Vitest

---

## ファイル構成

| ファイル | 役割 | 変更種別 |
|---------|------|---------|
| `vitest.config.ts` | プロジェクトルートの vitest 設定（再エクスポート） | 新規 |
| `testDir/vitest.config.ts` | 既存設定（内容は変更なし） | 変更不要 |
| `package.json` | `test` スクリプトの `--config` パラメータ削除（オプション） | 変更（任意） |

---

## 現状の問題点

1. `vitest.config.ts` が `testDir/` 内にある
2. Vitest の自動発見はルートの `vitest.config.*` のみ対象
3. `--config testDir/vitest.config.ts` なしでは設定が読み込まれない
4. `globals: true`、`setupFiles`、`exclude`、`testTimeout` が全て無効
5. 215件のテストがFalse Positiveで失敗

---

### Task 1: ルートに vitest.config.ts を作成

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: ルートに vitest.config.ts を作成**

```typescript
// vitest.config.ts（プロジェクトルート）
// Vitest の自動発見を有効にするため、testDir 内の設定を再エクスポートする
export { default } from './testDir/vitest.config';
```

- [ ] **Step 2: npx vitest run でテストを実行してパスを確認**

Run: `npx vitest run`
Expected: 全テストパス（以前 `npm test` でパスしていたものと同じ）

- [ ] **Step 3: npm test が引き続き動作することを確認**

Run: `npm test`
Expected: PASS（変更前と同じ結果）

- [ ] **Step 4: 両方の結果が一致することを確認**

Run: `npx vitest run --reporter=json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Tests: {d[\"numPassedTests\"]} passed, {d[\"numFailedTests\"]} failed')"`

Expected: `npm test` と同じ数値

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts
git commit -m "fix(test): add root vitest.config.ts for auto-discovery

Vitest auto-discovers config from project root only. The existing
config at testDir/vitest.config.ts was invisible without --config flag,
causing 215 false-positive test failures.

This adds a root-level re-export so npx vitest run works correctly."

Closes PBI-27"
```

---

### Task 2（任意）: package.json の --config パラメータを削除

**Files:**
- Modify: `package.json`

- [ ] **Step 1: test スクリプトから --config を削除**

```json
// 変更前
"test": "vitest run --config testDir/vitest.config.ts",
"test:watch": "vitest --config testDir/vitest.config.ts",
"test:coverage": "vitest run --config testDir/vitest.config.ts --coverage",

// 変更後
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
```

- [ ] **Step 2: テストを実行してパスを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: type-check を実行**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(test): remove explicit --config from test scripts

Root vitest.config.ts now handles auto-discovery."

Closes PBI-27"
```

---

### Task 3: testDir/vitest.config.ts の廃止注記

**Files:**
- Modify: `testDir/vitest.config.ts`

- [ ] **Step 1: ファイル冒頭に廃止注記を追加**

```typescript
/**
 * @deprecated このファイルはルートの vitest.config.ts に再エクスポートされています。
 * 直接参照する必要はありません。変更はルートの vitest.config.ts ではなく
 * このファイルに行ってください。
 */
```

- [ ] **Step 2: Commit**

```bash
git add testDir/vitest.config.ts
git commit -m "chore(test): add deprecation notice to testDir/vitest.config.ts"
```

---

## Definition of Done

- [ ] プロジェクトルートに `vitest.config.ts` が存在する
- [ ] `npx vitest run`（`--config` なし）で全テストがパスする
- [ ] `npm test` が引き続き動作する
- [ ] 215件のFalse Positiveが解消される
- [ ] IDE（VS Code Vitest 拡張）でテストが正しく実行される
