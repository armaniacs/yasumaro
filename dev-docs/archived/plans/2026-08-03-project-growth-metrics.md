# プロジェクト成長メトリクス履歴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** git タグ時点のコードを checkout せずに静的解析でメトリクス（行数・テスト数・関数数・ファイル数・依存関係数）を計測し、`dev-docs/metrics/history.json` に時系列で蓄積する仕組みを作る。release.yml から自動記録し、過去の主要マイルストーン18タグ分を backfill する。

**Architecture:** `scripts/metrics/collect.mjs` が `git ls-tree`/`git show <ref>:<path>` でタグ時点のファイル内容を読み出し、正規表現ベースでメトリクスを計測する純粋関数群を提供する。`scripts/metrics/updateHistory.mjs` がそれを呼び出して `history.json` に追記・ソートして書き戻す（同一tagは上書きし冪等性を保つ）。`scripts/metrics/backfill.mjs` は18個のマイルストーンタグに対して`updateHistory.mjs`のロジックをループ実行する。

**Tech Stack:** Node.js (ESM, `.mjs`), Vitest (`.test.ts`), 既存の `git` CLI 呼び出し（`execSync`）

**設計仕様:** `docs/superpowers/specs/2026-08-03-project-growth-metrics-design.md`

---

## 前提知識（既存パターンの踏襲）

このプロジェクトの `scripts/` ディレクトリは以下のパターンに従っている（`scripts/check-bundle-size.mjs` を参照）:

- 純粋ロジックは `export function xxx(...)` として切り出し、ファイルシステムやgit呼び出しから独立させる
- CLIエントリポイントは `main()` 関数にまとめ、末尾で `if (import.meta.url === \`file://${process.argv[1]}\`) { main(); }` によって「直接実行された場合のみ」実行する
- テストは `scripts/__tests__/<name>.test.ts` に置き、`.mjs` から named export を直接 import する
- テストランナーは **Vitest**（Jestではない）。`describe`/`it`/`expect` は `vitest` から import する
- ESM: 相対importには `.js`/`.mjs` の拡張子をそのまま使う（TypeScriptではなくプレーンJSなので変換不要）

---

## ファイル構成

- Create: `scripts/metrics/collect.mjs` — 1タグ分のメトリクス計測ロジック（純粋関数 + gitラッパー）
- Create: `scripts/metrics/updateHistory.mjs` — history.json への追記・ソート・書き戻しロジック + CLIエントリポイント
- Create: `scripts/metrics/backfill.mjs` — 18タグを順に処理するCLIスクリプト
- Create: `scripts/metrics/__tests__/collect.test.ts` — collect.mjs の純粋関数の単体テスト
- Create: `scripts/metrics/__tests__/updateHistory.test.ts` — updateHistory.mjs のマージ・ソートロジックの単体テスト
- Create: `dev-docs/metrics/history.json` — メトリクス履歴データ（初回はbackfillで生成）
- Modify: `package.json` — `metrics:collect` / `metrics:backfill` npm script 追加
- Modify: `.github/workflows/release.yml` — メトリクス計測・コミット・pushステップ追加

---

### Task 1: `collect.mjs` の純粋計測ロジックを実装する

**Files:**
- Create: `scripts/metrics/collect.mjs`
- Test: `scripts/metrics/__tests__/collect.test.ts`

まず、gitコマンド出力（文字列）を受け取ってメトリクスを計算する部分だけを純粋関数として実装する。git呼び出し自体はTask 2で薄いラッパーとして追加する。

- [ ] **Step 1: Write the failing test for `countLines`**

```typescript
// scripts/metrics/__tests__/collect.test.ts
import { describe, it, expect } from 'vitest';
import { countLines, countTestCalls, countFunctionDefinitions, countDependencies } from '../collect.mjs';

describe('countLines', () => {
  it('counts non-empty file content as line count', () => {
    const content = 'line1\nline2\nline3\n';
    expect(countLines(content)).toBe(3);
  });

  it('returns 0 for empty content', () => {
    expect(countLines('')).toBe(0);
  });

  it('counts a single line without trailing newline', () => {
    expect(countLines('const x = 1;')).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: FAIL — `Cannot find module '../collect.mjs'` (ファイルが存在しない)

- [ ] **Step 3: Write minimal implementation for `countLines`**

```javascript
// scripts/metrics/collect.mjs
#!/usr/bin/env node

/**
 * Static-analysis metric collection for a single git ref (tag or HEAD).
 * Reads file contents via `git show <ref>:<path>` without checking out
 * the working tree, so it is safe to run against arbitrary historical tags.
 */

export function countLines(content) {
  if (content === '') return 0;
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.split('\n').length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for `countTestCalls`**

Add to `scripts/metrics/__tests__/collect.test.ts`:

```typescript
describe('countTestCalls', () => {
  it('counts it( and test( calls', () => {
    const content = `
      describe('foo', () => {
        it('does a thing', () => {});
        test('does another thing', () => {});
        it('does a third thing', () => {});
      });
    `;
    expect(countTestCalls(content)).toBe(3);
  });

  it('returns 0 when there are no test calls', () => {
    expect(countTestCalls('const x = 1;')).toBe(0);
  });

  it('does not count it( inside identifiers like "unit("', () => {
    const content = 'function unit() { return 1; }';
    expect(countTestCalls(content)).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: FAIL — `countTestCalls is not a function`

- [ ] **Step 7: Write minimal implementation for `countTestCalls`**

Add to `scripts/metrics/collect.mjs`:

```javascript
export function countTestCalls(content) {
  const matches = content.match(/\b(it|test)\s*\(/g);
  return matches ? matches.length : 0;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 9: Write the failing test for `countFunctionDefinitions`**

Add to `scripts/metrics/__tests__/collect.test.ts`:

```typescript
describe('countFunctionDefinitions', () => {
  it('counts function declarations', () => {
    const content = 'function foo() {}\nfunction bar() {}';
    expect(countFunctionDefinitions(content)).toBe(2);
  });

  it('counts arrow functions assigned to a const', () => {
    const content = 'const foo = () => {};\nconst bar = (x) => x + 1;';
    expect(countFunctionDefinitions(content)).toBe(2);
  });

  it('counts async function declarations', () => {
    const content = 'async function foo() {}';
    expect(countFunctionDefinitions(content)).toBe(1);
  });

  it('returns 0 for content with no functions', () => {
    expect(countFunctionDefinitions('const x = 1;')).toBe(0);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: FAIL — `countFunctionDefinitions is not a function`

- [ ] **Step 11: Write minimal implementation for `countFunctionDefinitions`**

Add to `scripts/metrics/collect.mjs`:

```javascript
export function countFunctionDefinitions(content) {
  const functionDeclarations = content.match(/\bfunction\s*\*?\s*[\w$]*\s*\(/g) || [];
  const arrowFunctions = content.match(/=\s*(async\s*)?\([^)]*\)\s*=>/g) || [];
  const arrowFunctionsSingleArg = content.match(/=\s*(async\s*)?[\w$]+\s*=>/g) || [];
  return functionDeclarations.length + arrowFunctions.length + arrowFunctionsSingleArg.length;
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 13: Write the failing test for `countDependencies`**

Add to `scripts/metrics/__tests__/collect.test.ts`:

```typescript
describe('countDependencies', () => {
  it('sums dependencies and devDependencies counts', () => {
    const packageJson = JSON.stringify({
      dependencies: { a: '1.0.0', b: '2.0.0' },
      devDependencies: { c: '3.0.0' },
    });
    expect(countDependencies(packageJson)).toBe(3);
  });

  it('returns 0 when both fields are missing', () => {
    const packageJson = JSON.stringify({ name: 'foo' });
    expect(countDependencies(packageJson)).toBe(0);
  });

  it('handles only dependencies present', () => {
    const packageJson = JSON.stringify({ dependencies: { a: '1.0.0' } });
    expect(countDependencies(packageJson)).toBe(1);
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: FAIL — `countDependencies is not a function`

- [ ] **Step 15: Write minimal implementation for `countDependencies`**

Add to `scripts/metrics/collect.mjs`:

```javascript
export function countDependencies(packageJsonContent) {
  const parsed = JSON.parse(packageJsonContent);
  const deps = parsed.dependencies ? Object.keys(parsed.dependencies).length : 0;
  const devDeps = parsed.devDependencies ? Object.keys(parsed.devDependencies).length : 0;
  return deps + devDeps;
}
```

- [ ] **Step 16: Run test to verify it passes**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 17: Commit**

```bash
git add scripts/metrics/collect.mjs scripts/metrics/__tests__/collect.test.ts
git commit -m "feat(metrics): 静的解析によるメトリクス計測の純粋関数を実装"
```

---

### Task 2: `collect.mjs` に git 連携（ref からファイル一覧・内容取得）を追加する

**Files:**
- Modify: `scripts/metrics/collect.mjs`
- Test: `scripts/metrics/__tests__/collect.test.ts`

Task 1 の純粋関数を使い、実際に指定した git ref に対してメトリクスを集計する `collectMetricsForRef(ref)` を追加する。git呼び出し部分は `execSync` を薄くラップし、モック可能な形にする。

- [ ] **Step 1: Write the failing test for `listSourceFiles`**

Add to `scripts/metrics/__tests__/collect.test.ts`:

```typescript
import { listSourceFiles } from '../collect.mjs';

describe('listSourceFiles', () => {
  it('filters to src/ and entrypoints/ .ts/.tsx/.js files only', () => {
    const allFiles = [
      'src/foo.ts',
      'src/foo.test.ts',
      'entrypoints/background/index.ts',
      'README.md',
      'docs/design.md',
      'src/bar.tsx',
      'scripts/build.mjs',
    ];
    const result = listSourceFiles(allFiles);
    expect(result).toEqual([
      'src/foo.ts',
      'src/foo.test.ts',
      'entrypoints/background/index.ts',
      'src/bar.tsx',
    ]);
  });

  it('returns an empty array when no files match', () => {
    expect(listSourceFiles(['README.md', 'package.json'])).toEqual([]);
  });
});

describe('isTestFile', () => {
  it('recognizes .test.ts and .spec.ts files', () => {
    expect(isTestFile('src/foo.test.ts')).toBe(true);
    expect(isTestFile('src/foo.spec.ts')).toBe(true);
    expect(isTestFile('src/foo.ts')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: FAIL — `listSourceFiles is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `scripts/metrics/collect.mjs`:

```javascript
const SOURCE_FILE_PATTERN = /^(src|entrypoints)\/.*\.(ts|tsx|js)$/;
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js)$/;

export function listSourceFiles(allFilePaths) {
  return allFilePaths.filter((path) => SOURCE_FILE_PATTERN.test(path));
}

export function isTestFile(path) {
  return TEST_FILE_PATTERN.test(path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Write the failing test for `collectMetricsForRef` (with injected git functions)**

Add to `scripts/metrics/__tests__/collect.test.ts`:

```typescript
import { collectMetricsForRef } from '../collect.mjs';

describe('collectMetricsForRef', () => {
  it('aggregates metrics across files using injected git accessors', async () => {
    const fakeGit = {
      listFiles: () => ['src/foo.ts', 'src/foo.test.ts', 'entrypoints/bg.ts', 'package.json'],
      readFile: (ref, path) => {
        const files = {
          'src/foo.ts': 'function foo() {}\nconst bar = () => 1;\n',
          'src/foo.test.ts': "it('works', () => {});\nit('also works', () => {});\n",
          'entrypoints/bg.ts': 'export const x = 1;\n',
          'package.json': JSON.stringify({
            version: '1.2.3',
            dependencies: { a: '1.0.0' },
            devDependencies: { b: '1.0.0', c: '1.0.0' },
          }),
        };
        return files[path];
      },
      getTagDate: () => '2026-01-01T00:00:00+09:00',
    };

    const result = await collectMetricsForRef('v1.2.3', fakeGit);

    expect(result).toEqual({
      version: '1.2.3',
      tag: 'v1.2.3',
      date: '2026-01-01T00:00:00+09:00',
      linesOfCode: 4,
      fileCount: 3,
      testCount: 2,
      functionCount: 2,
      dependencyCount: 3,
    });
  });

  it('skips files that fail to read instead of throwing', async () => {
    const fakeGit = {
      listFiles: () => ['src/foo.ts', 'src/missing.ts'],
      readFile: (ref, path) => {
        if (path === 'src/missing.ts') return undefined;
        return 'const x = 1;\n';
      },
      getTagDate: () => '2026-01-01T00:00:00+09:00',
    };

    const result = await collectMetricsForRef('v1.0.0', fakeGit);
    expect(result.fileCount).toBe(1);
    expect(result.linesOfCode).toBe(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: FAIL — `collectMetricsForRef is not a function`

- [ ] **Step 7: Write minimal implementation**

Add to `scripts/metrics/collect.mjs`:

```javascript
export async function collectMetricsForRef(ref, git) {
  const allFiles = git.listFiles(ref);
  const sourceFiles = listSourceFiles(allFiles);

  let linesOfCode = 0;
  let fileCount = 0;
  let testCount = 0;
  let functionCount = 0;

  for (const path of sourceFiles) {
    const content = git.readFile(ref, path);
    if (content === undefined) continue;

    fileCount += 1;
    linesOfCode += countLines(content);
    functionCount += countFunctionDefinitions(content);
    if (isTestFile(path)) {
      testCount += countTestCalls(content);
    }
  }

  const packageJsonContent = git.readFile(ref, 'package.json');
  const packageJson = JSON.parse(packageJsonContent);

  return {
    version: packageJson.version,
    tag: ref,
    date: git.getTagDate(ref),
    linesOfCode,
    fileCount,
    testCount,
    functionCount,
    dependencyCount: countDependencies(packageJsonContent),
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: PASS (18 tests)

- [ ] **Step 9: Add the real git accessor implementation and CLI entrypoint**

Add to `scripts/metrics/collect.mjs`:

```javascript
import { execFileSync } from 'node:child_process';

export const realGit = {
  listFiles(ref) {
    const output = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
      encoding: 'utf-8',
    });
    return output.split('\n').filter(Boolean);
  },
  readFile(ref, path) {
    try {
      return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf-8' });
    } catch {
      return undefined;
    }
  },
  getTagDate(ref) {
    return execFileSync('git', ['log', '-1', '--format=%aI', ref], { encoding: 'utf-8' }).trim();
  },
};

async function main() {
  const ref = process.argv[2];
  if (!ref) {
    console.error('Usage: node scripts/metrics/collect.mjs <git-ref>');
    process.exit(1);
  }
  const metrics = await collectMetricsForRef(ref, realGit);
  console.log(JSON.stringify(metrics, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 10: Run the full test suite for this file once more**

Run: `npx vitest run scripts/metrics/__tests__/collect.test.ts`
Expected: PASS (18 tests) — CLI追加部分はexportされる純粋関数を変更しないため、既存テストは影響を受けない

- [ ] **Step 11: Manually verify against the real repository**

Run: `node scripts/metrics/collect.mjs HEAD`
Expected: 妥当な `version`/`tag`/`date`/`linesOfCode` 等を含むJSONが出力される（エラーなし）

- [ ] **Step 12: Commit**

```bash
git add scripts/metrics/collect.mjs scripts/metrics/__tests__/collect.test.ts
git commit -m "feat(metrics): git refからのメトリクス集計とCLIエントリポイントを追加"
```

---

### Task 3: `updateHistory.mjs` で history.json への追記・ソートを実装する

**Files:**
- Create: `scripts/metrics/updateHistory.mjs`
- Test: `scripts/metrics/__tests__/updateHistory.test.ts`

- [ ] **Step 1: Write the failing test for `mergeRecord`**

```typescript
// scripts/metrics/__tests__/updateHistory.test.ts
import { describe, it, expect } from 'vitest';
import { mergeRecord } from '../updateHistory.mjs';

describe('mergeRecord', () => {
  it('appends a new record to an empty list', () => {
    const record = { tag: 'v1.0.0', date: '2026-01-01T00:00:00+09:00', version: '1.0.0' };
    const result = mergeRecord([], record);
    expect(result).toEqual([record]);
  });

  it('appends a new record and sorts by date ascending', () => {
    const older = { tag: 'v1.0.0', date: '2026-01-01T00:00:00+09:00', version: '1.0.0' };
    const newer = { tag: 'v2.0.0', date: '2026-02-01T00:00:00+09:00', version: '2.0.0' };
    const result = mergeRecord([newer], older);
    expect(result).toEqual([older, newer]);
  });

  it('overwrites an existing record with the same tag', () => {
    const original = { tag: 'v1.0.0', date: '2026-01-01T00:00:00+09:00', version: '1.0.0', linesOfCode: 100 };
    const updated = { tag: 'v1.0.0', date: '2026-01-01T00:00:00+09:00', version: '1.0.0', linesOfCode: 200 };
    const result = mergeRecord([original], updated);
    expect(result).toEqual([updated]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/metrics/__tests__/updateHistory.test.ts`
Expected: FAIL — `Cannot find module '../updateHistory.mjs'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/metrics/updateHistory.mjs
#!/usr/bin/env node

/**
 * Appends (or overwrites, by tag) a single metrics record into
 * dev-docs/metrics/history.json, keeping the array sorted by date ascending.
 */

export function mergeRecord(existingRecords, newRecord) {
  const withoutDuplicate = existingRecords.filter((r) => r.tag !== newRecord.tag);
  const merged = [...withoutDuplicate, newRecord];
  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/metrics/__tests__/updateHistory.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for `readHistoryFile` / `formatHistoryFile`**

Add to `scripts/metrics/__tests__/updateHistory.test.ts`:

```typescript
import { readHistoryFile, formatHistoryFile } from '../updateHistory.mjs';

describe('readHistoryFile', () => {
  it('parses an existing history JSON string', () => {
    const content = JSON.stringify({ records: [{ tag: 'v1.0.0' }] });
    expect(readHistoryFile(content)).toEqual([{ tag: 'v1.0.0' }]);
  });

  it('returns an empty array when content is undefined (file does not exist yet)', () => {
    expect(readHistoryFile(undefined)).toEqual([]);
  });
});

describe('formatHistoryFile', () => {
  it('wraps records in a { records: [...] } object, pretty-printed', () => {
    const records = [{ tag: 'v1.0.0' }];
    const result = formatHistoryFile(records);
    expect(JSON.parse(result)).toEqual({ records });
    expect(result.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run scripts/metrics/__tests__/updateHistory.test.ts`
Expected: FAIL — `readHistoryFile is not a function`

- [ ] **Step 7: Write minimal implementation**

Add to `scripts/metrics/updateHistory.mjs`:

```javascript
export function readHistoryFile(content) {
  if (content === undefined) return [];
  return JSON.parse(content).records;
}

export function formatHistoryFile(records) {
  return `${JSON.stringify({ records }, null, 2)}\n`;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run scripts/metrics/__tests__/updateHistory.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 9: Add the CLI entrypoint wiring collect.mjs + filesystem**

Add to `scripts/metrics/updateHistory.mjs`:

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMetricsForRef, realGit } from './collect.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
export const HISTORY_FILE_PATH = join(ROOT_DIR, 'dev-docs', 'metrics', 'history.json');

async function main() {
  const ref = process.argv[2];
  if (!ref) {
    console.error('Usage: node scripts/metrics/updateHistory.mjs <git-ref>');
    process.exit(1);
  }

  const newRecord = await collectMetricsForRef(ref, realGit);

  const existingContent = existsSync(HISTORY_FILE_PATH)
    ? readFileSync(HISTORY_FILE_PATH, 'utf-8')
    : undefined;
  const existingRecords = readHistoryFile(existingContent);
  const merged = mergeRecord(existingRecords, newRecord);

  mkdirSync(dirname(HISTORY_FILE_PATH), { recursive: true });
  writeFileSync(HISTORY_FILE_PATH, formatHistoryFile(merged));

  console.log(`Recorded metrics for ${ref} -> ${HISTORY_FILE_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 10: Run the full test suite for this file once more**

Run: `npx vitest run scripts/metrics/__tests__/updateHistory.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 11: Manually verify against the real repository (dry run against HEAD)**

Run: `node scripts/metrics/updateHistory.mjs HEAD`
Expected: `dev-docs/metrics/history.json` が作成され、`HEAD` タグ相当の1レコードが書き込まれる。内容を確認後、このテスト用レコードは Task 5 (backfill) 実行前に削除する（`rm dev-docs/metrics/history.json`）

- [ ] **Step 12: Remove the test-run output before committing**

Run: `rm -f dev-docs/metrics/history.json`

- [ ] **Step 13: Commit**

```bash
git add scripts/metrics/updateHistory.mjs scripts/metrics/__tests__/updateHistory.test.ts
git commit -m "feat(metrics): history.jsonへの追記・ソートロジックとCLIを追加"
```

---

### Task 4: `backfill.mjs` を実装し、npm script を追加する

**Files:**
- Create: `scripts/metrics/backfill.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write `backfill.mjs`**

```javascript
// scripts/metrics/backfill.mjs
#!/usr/bin/env node

/**
 * One-off backfill: records historical metrics for the first tag of each
 * minor release series, from v2.0.0 through v6.7.2.
 *
 * Usage: node scripts/metrics/backfill.mjs
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPDATE_HISTORY_SCRIPT = join(__dirname, 'updateHistory.mjs');

export const MILESTONE_TAGS = [
  'v2.0.0',
  'v2.1.0',
  'v2.2.0',
  'v2.3.0',
  'v3.0.0',
  'v4.0.0',
  'v4.1',
  'v4.2.0',
  'v5.0.0',
  'v5.1.0',
  'v5.2.0',
  'v6.0.1',
  'v6.1.2',
  'v6.3.0',
  'v6.4.0',
  'v6.5.2',
  'v6.6.0',
  'v6.7.2',
];

function main() {
  const failures = [];
  for (const tag of MILESTONE_TAGS) {
    console.log(`Recording metrics for ${tag}...`);
    try {
      execFileSync('node', [UPDATE_HISTORY_SCRIPT, tag], { stdio: 'inherit' });
    } catch (error) {
      console.error(`Failed to record metrics for ${tag}: ${error.message}`);
      failures.push(tag);
    }
  }

  if (failures.length > 0) {
    console.error(`Backfill completed with failures: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('Backfill completed successfully.');
}

main();
```

- [ ] **Step 2: Add npm scripts**

Read `package.json` current scripts block, then add these two entries alongside the existing `lint:adr-links` entry:

```json
"metrics:collect": "node scripts/metrics/updateHistory.mjs",
"metrics:backfill": "node scripts/metrics/backfill.mjs",
```

- [ ] **Step 3: Run backfill against the real repository**

Run: `npm run metrics:backfill`
Expected: 18行の `Recording metrics for vX...` ログが出力され、最後に `Backfill completed successfully.` と表示される。いずれかのタグで `package.json` が存在しない等の理由で失敗した場合は、そのタグ名がログに出るので、該当タグを `MILESTONE_TAGS` から除外するか、`collectMetricsForRef` のエラーハンドリング（Task 2で実装済みの「読めないファイルはスキップ」）で対応できているか確認する

- [ ] **Step 4: Inspect the generated history.json**

Run: `cat dev-docs/metrics/history.json`
Expected: `records` 配列に18件、`date` 昇順（v2.0.0が先頭、v6.7.2が末尾）で並んでいる

- [ ] **Step 5: Commit**

```bash
git add scripts/metrics/backfill.mjs package.json dev-docs/metrics/history.json
git commit -m "feat(metrics): 主要マイルストーン18タグ分のメトリクスをbackfill"
```

---

### Task 5: release.yml にメトリクス記録ステップを追加する

**Files:**
- Modify: `.github/workflows/release.yml`

`Create Release` ステップ（`softprops/action-gh-release`）の直後に、メトリクス計測・コミット・push のステップを追加する。ファイル全体は [.github/workflows/release.yml](.github/workflows/release.yml) を参照。追加位置は 82行目 `prerelease: false` の直後、86行目 `Publish to Chrome Web Store` ステップの前。

- [ ] **Step 1: Insert the new steps**

`.github/workflows/release.yml` の該当箇所（`prerelease: false` の次の行、空行を挟んで `- name: Publish to Chrome Web Store` の前）に以下を挿入する:

```yaml
      - name: Record project metrics
        run: node scripts/metrics/updateHistory.mjs ${{ github.ref_name }}

      - name: Commit metrics history
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add dev-docs/metrics/history.json
          git commit -m "chore(metrics): record ${{ github.ref_name }} growth metrics" || echo "No changes to commit"
          git push origin HEAD:main
```

- [ ] **Step 2: Verify YAML syntax**

Run: `node -e "require('js-yaml') ? '' : ''" 2>/dev/null; npx yaml-lint .github/workflows/release.yml 2>/dev/null || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML OK"`
Expected: `YAML OK` が出力される（`python3`が使えない場合は、エディタ上でインデントのずれがないか目視確認する）

- [ ] **Step 3: Review the diff manually**

Run: `git diff .github/workflows/release.yml`
Expected: 追加した2ステップのみが差分に含まれ、既存ステップに変更がないことを確認する

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): リリース時にメトリクス計測・コミットを自動実行"
```

---

### Task 6: 型チェック・全体テストで既存への影響がないことを確認する

**Files:** なし（検証のみ）

- [ ] **Step 1: Run type-check**

Run: `npm run type-check`
Expected: 既存のエラーが増えていないこと（`.mjs`ファイルは型チェック対象外のため影響しないはずだが、`tsconfig.json`のincludeパターンに`scripts/**`が含まれていないか念のため確認する）

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: 既存のテストに加え、`scripts/metrics/__tests__/collect.test.ts`（18件）と `scripts/metrics/__tests__/updateHistory.test.ts`（5件）がPASSする

- [ ] **Step 3: Run validate (pre-commit gate)**

Run: `npm run validate`
Expected: PASS

---

## Self-Review Notes

- **Spec coverage**: メトリクス項目（Task 1-2）、静的解析方式（Task 2の`realGit`実装）、history.json構造（Task 3）、release.yml組み込み（Task 5）、backfill対象18タグ（Task 4）を全てカバー。
- **Type consistency**: `collectMetricsForRef(ref, git)` のシグネチャ、`mergeRecord(existingRecords, newRecord)`、`readHistoryFile(content)`、`formatHistoryFile(records)` の名前・引数順序は全タスクを通して統一。
- **エラーハンドリング**: 仕様の「package.jsonがパース不能ならスキップ」は、Task 2 の `collectMetricsForRef` 内で `readFile` が `undefined` を返すケースをスキップする形で対応しているが、`package.json` 自体が読めない場合（`JSON.parse(undefined)`で例外)は現状 `backfill.mjs` の try/catch でタグ単位の失敗として扱われ、ログに出力されて処理は継続する。個別タグの詳細な原因調査はTask 4 Step 3実行時に必要であれば対応する。
