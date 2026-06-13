# Review Fixes — Normal Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レビューで検出された **Medium 36件** を 8 トラック並走で解消し、総合スコアを C (68.9) → A (80+) に引き上げる。

**Architecture:** 既存モジュール構造を最大限尊重。各トラックは独立した PR として並走可能。テーマ別に i18n、a11y、performance、observability、refactor、documentation、PII、cost の 8 軸で改善。

**Tech Stack:** TypeScript / Chrome Extension Manifest V3 / wa-sqlite / Jest (Vitest) / @peculiar/webcrypto

**親ドキュメント:** [dev-docs/plans/tobe-yasumaro/2026-06-13-002-review-fixes-design.md](2026-06-13-002-review-fixes-design.md)
**Hotfix 計画:** [dev-docs/plans/tobe-yasumaro/2026-06-13-003-review-fixes-hotfix-plan.md](2026-06-13-003-review-fixes-hotfix-plan.md)

---

## File Structure

### トラック別 修正対象ファイル

| Track | ファイル | 変更内容 |
|---|---|---|
| N1 i18n | `src/dashboard/cleansingStatsView.ts`, `src/dashboard/sqliteHistoryPanel.ts`, `public/_locales/{ja,en}/messages.json` | ハードコード文字列の `data-i18n` 化、翻訳追加 |
| N2 a11y | `src/dashboard/navigation.ts`, `src/popup/spinner.ts`, `src/dashboard/sqliteHistoryPanel.ts`, `src/dashboard/utils/confirmDialog.ts` | ARIA tabs パターン、aria-live、`window.confirm` 脱却 |
| N3 perf | `src/offscreen/sqlite.ts`, `src/background/migrationService.ts`, `src/background/recordingTriggerManager.ts` | prepared-statement キャッシュ、storage 書き込み最適化、storage.onChanged 連動 |
| N4 observability | `src/utils/logger.ts`, 全 `*.ts` ファイル | 構造化ログ全面適用、`chrome.notifications` アラートパス |
| N5 refactor | `src/utils/errorUtils.ts` 利用者全ファイル, `src/background/rateLimiter.ts` (Hotfix 後の残存 setTimeout), `package.json` | errorMessage 全面適用、wa-sqlite 重複解消 |
| N6 docs | `README.md`, `CHANGELOG.md`, `docs/*.md`, `dev-docs/blogs/*`, `dev-docs/plans/tobe-yasumaro/pbi/*` | 旧ブランド名 `yasumaro` への置換 |
| N7 PII | `src/background/manualContentFetcher.ts`, `src/utils/piiSanitizer.ts`, `src/offscreen/sqlite.ts`, `docs/PRIVACY.md` | PII サニタイズ統合、地域バイアス解消、保持期間実装 |
| N8 cost | `src/background/ai/providers/OpenAIProvider.ts`, `src/background/obsidianSyncService.ts`, `src/offscreen/sqlite.ts` | content limit 調整、Obsidian 同期バッチ化、FTS5 評価 |

---

## Task 1: N1 — i18n 漏れ修正

**Files:**
- Modify: `src/dashboard/cleansingStatsView.ts`
- Modify: `src/dashboard/sqliteHistoryPanel.ts`
- Modify: `public/_locales/ja/messages.json`
- Modify: `public/_locales/en/messages.json`

- [ ] **Step 1.1: ハードコード文字列を抽出**

`Grep` で以下を実行:

```bash
grep -n "textContent\s*=\s*['\"][^'\"]*['\"]" src/dashboard/cleansingStatsView.ts src/dashboard/sqliteHistoryPanel.ts
```

抽出した文字列をリスト化し、翻訳キーを決める。

- [ ] **Step 1.2: 日本語訳を `_locales/ja/messages.json` に追加**

例（`cleansingStatsView.ts` の場合）:

```json
{
  "cleansingStatsTitle": { "message": "クレンジング統計" },
  "cleansingStatsTotalProcessed": { "message": "処理済み総数" },
  "cleansingStatsTokensSaved": { "message": "節約トークン数" },
  "cleansingStatsAverageRatio": { "message": "平均圧縮率" }
}
```

- [ ] **Step 1.3: 英語訳を `_locales/en/messages.json` に追加**

```json
{
  "cleansingStatsTitle": { "message": "Cleansing Statistics" },
  "cleansingStatsTotalProcessed": { "message": "Total Processed" },
  "cleansingStatsTokensSaved": { "message": "Tokens Saved" },
  "cleansingStatsAverageRatio": { "message": "Average Compression Ratio" }
}
```

- [ ] **Step 1.4: 該当 TS ファイルでハードコード文字列を `data-i18n` に置換**

```typescript
// Before
element.textContent = '処理済み総数';

// After
element.setAttribute('data-i18n', 'cleansingStatsTotalProcessed');
applyI18n(element);  // helper that reads data-i18n and sets textContent
```

- [ ] **Step 1.5: i18n バリデーションを実行**

```bash
npm run i18n:validate
```

Expected: All keys present in both locales

- [ ] **Step 1.6: テスト実行**

```bash
npx vitest run src/popup/__tests__/i18n.test.ts
```

- [ ] **Step 1.7: Commit**

```bash
git add src/dashboard/cleansingStatsView.ts src/dashboard/sqliteHistoryPanel.ts public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "i18n(dashboard): extract hardcoded strings and add data-i18n attributes (N1)

- Add cleansingStats* keys to both ja/en locales
- Add sqliteHistoryPanel* keys (pagination, search, date format)
- Replace hardcoded text with data-i18n attributes

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 2: N2 — アクセシビリティ

**Files:**
- Modify: `src/dashboard/navigation.ts` (sidebar ARIA tabs)
- Modify: `src/popup/spinner.ts` (aria-live)
- Modify: `src/dashboard/sqliteHistoryPanel.ts` (delete confirmation)
- Create: `src/dashboard/utils/confirmDialog.ts` (accessible modal)

- [ ] **Step 2.1: 失敗するテストを追加**

`src/dashboard/__tests__/navigation.a11y.test.ts` 新規作成:

```typescript
import { initNavigation } from '../navigation.js';

describe('dashboard navigation — ARIA tabs (N2)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" id="tab-1" aria-selected="false" aria-controls="panel-1">Tab 1</button>
        <button role="tab" id="tab-2" aria-selected="false" aria-controls="panel-2">Tab 2</button>
      </nav>
      <section id="panel-1" role="tabpanel" aria-labelledby="tab-1" hidden>Panel 1</section>
      <section id="panel-2" role="tabpanel" aria-labelledby="tab-2" hidden>Panel 2</section>
    `;
  });

  it('toggles aria-selected when a tab is clicked', () => {
    initNavigation();
    const tab2 = document.getElementById('tab-2')!;
    tab2.click();
    expect(tab2.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('false');
  });

  it('shows the corresponding panel and hides others', () => {
    initNavigation();
    const tab2 = document.getElementById('tab-2')!;
    tab2.click();
    expect(document.getElementById('panel-2')!.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('panel-1')!.hasAttribute('hidden')).toBe(true);
  });

  it('supports keyboard navigation (Arrow Right)', () => {
    initNavigation();
    const tab1 = document.getElementById('tab-1')!;
    tab1.focus();
    tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(document.getElementById('tab-2'));
  });
});
```

- [ ] **Step 2.2: テスト実行して失敗を確認**

```bash
npx vitest run src/dashboard/__tests__/navigation.a11y.test.ts
```

- [ ] **Step 2.3: `initNavigation` を ARIA tabs パターンを満たすように修正**

`src/dashboard/navigation.ts` の該当箇所を修正:

```typescript
export function initNavigation(): void {
  const tablist = document.querySelector<HTMLElement>('[role="tablist"]');
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
  const panels = tabs.map((tab) =>
    document.getElementById(tab.getAttribute('aria-controls') || '')
  );

  const activate = (index: number) => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      if (panels[i]) {
        if (selected) panels[i]!.removeAttribute('hidden');
        else panels[i]!.setAttribute('hidden', '');
      }
    });
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(i));
    tab.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === 'ArrowRight') {
        e.preventDefault();
        const next = (i + 1) % tabs.length;
        tabs[next]!.focus();
        activate(next);
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        const prev = (i - 1 + tabs.length) % tabs.length;
        tabs[prev]!.focus();
        activate(prev);
      }
    });
  });

  // Initialize first tab
  if (tabs.length > 0) activate(0);
}
```

- [ ] **Step 2.4: スピナーに `aria-live` 追加**

`src/popup/spinner.ts` のスピナー要素に `aria-live="polite"` および `role="status"` を追加。

- [ ] **Step 2.5: アクセシブルな確認モーダル実装**

`src/dashboard/utils/confirmDialog.ts` 新規作成:

```typescript
interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  dangerous?: boolean;
}

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'confirm-dialog-title');
    overlay.setAttribute('aria-describedby', 'confirm-dialog-message');
    overlay.className = 'confirm-dialog-overlay';

    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h2 id="confirm-dialog-title">${escapeHtml(options.title)}</h2>
        <p id="confirm-dialog-message">${escapeHtml(options.message)}</p>
        <div class="confirm-dialog-actions">
          <button type="button" data-action="cancel">${escapeHtml(options.cancelLabel)}</button>
          <button type="button" data-action="confirm" ${options.dangerous ? 'class="danger"' : ''}>${escapeHtml(options.confirmLabel)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const focusFirst = () => {
      const firstButton = overlay.querySelector<HTMLButtonElement>('button');
      firstButton?.focus();
    };
    setTimeout(focusFirst, 0);

    const close = (result: boolean) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.action === 'confirm') close(true);
      else if (target.dataset.action === 'cancel') close(false);
      else if (target === overlay) close(false);
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}
```

- [ ] **Step 2.6: `sqliteHistoryPanel.ts` の `window.confirm` を `showConfirmDialog` に置換**

```typescript
// Before
if (!confirm('削除しますか？')) return;

// After
const confirmed = await showConfirmDialog({
  title: chrome.i18n.getMessage('confirmDeleteTitle'),
  message: chrome.i18n.getMessage('confirmDeleteMessage'),
  confirmLabel: chrome.i18n.getMessage('confirmDelete'),
  cancelLabel: chrome.i18n.getMessage('cancel'),
  dangerous: true,
});
if (!confirmed) return;
```

- [ ] **Step 2.7: テストを再実行して PASS を確認**

```bash
npx vitest run src/dashboard/__tests__/navigation.a11y.test.ts
```

- [ ] **Step 2.8: Commit**

```bash
git add src/dashboard/navigation.ts src/popup/spinner.ts src/dashboard/utils/confirmDialog.ts src/dashboard/sqliteHistoryPanel.ts src/dashboard/__tests__/navigation.a11y.test.ts
git commit -m "a11y(dashboard): add ARIA tabs pattern, aria-live spinner, accessible confirm modal (N2)

- Navigation tabs now support arrow key navigation and proper aria-selected
- Spinner announces loading state to screen readers via aria-live=polite
- Replace window.confirm in sqliteHistoryPanel with accessible modal
- Add new showConfirmDialog utility with focus trap and Escape support

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 3: N3 — パフォーマンス最適化

**Files:**
- Modify: `src/offscreen/sqlite.ts` (insertBatch prepared-statement cache)
- Modify: `src/background/migrationService.ts` (batch storage write)
- Modify: `src/background/recordingTriggerManager.ts` (storage.onChanged hook)

- [ ] **Step 3.1: `insertBatch` の prepared-statement キャッシュ**

`src/offscreen/sqlite.ts` の `insertBatch` を修正:

```typescript
// Add a module-level cache
let insertStmt: { stmt: unknown; reset: () => void } | null = null;

function prepareInsertStatement(sqlite3: WaSqliteAPI, db: number): unknown {
  if (insertStmt) return insertStmt.stmt;
  const stmt = sqlite3.prepare_v2(
    db,
    'INSERT OR IGNORE INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertStmt = { stmt, reset: () => sqlite3.reset(stmt) };
  return stmt;
}

export async function insertBatch(records: BrowsingLogRecord[]): Promise<{ success: true; count: number } | { success: false; error: string }> {
  if (!dbHandle || !sqlite3) return { success: false, error: 'Database not initialized' };
  try {
    const stmt = prepareInsertStatement(sqlite3, dbHandle);
    sqlite3.exec(dbHandle, 'BEGIN TRANSACTION');
    let count = 0;
    for (const r of records) {
      sqlite3.reset(stmt);
      sqlite3.bind_text(stmt, 1, r.url);
      // ... bind other params
      sqlite3.step(stmt);
      if (sqlite3.changes(dbHandle) > 0) count++;
    }
    sqlite3.exec(dbHandle, 'COMMIT');
    return { success: true, count };
  } catch (error) {
    sqlite3.exec(dbHandle, 'ROLLBACK');
    return { success: false, error: errorMessage(error) };
  } finally {
    insertStmt?.reset();
  }
}
```

- [ ] **Step 3.2: `MigrationService` の storage 書き込み最適化**

`src/background/migrationService.ts` の `run()` メソッドで、バッチごと `setMigrationProgress` を呼ぶ代わりに、**N 件ごと**（例: 100件）または **完了時のみ** に変更。

```typescript
const PROGRESS_WRITE_INTERVAL = 100;
// ... in the loop:
if ((i / BATCH_SIZE) % PROGRESS_WRITE_INTERVAL === 0) {
  await this.setMigrationProgress(progress + i);
}
```

- [ ] **Step 3.3: `recordingTriggerManager` の storage.onChanged 連動**

`src/background/recordingTriggerManager.ts` に以下を追加:

```typescript
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[StorageKeys.RECORDING_TRIGGERS]) {
    this.cachedTriggers = changes[StorageKeys.RECORDING_TRIGGERS].newValue as RecordingTrigger[];
  }
});
```

- [ ] **Step 3.4: パフォーマンステスト追加**

`src/offscreen/__tests__/sqlite-perf.test.ts` 新規作成:

```typescript
import { init, insertBatch } from '../sqlite.js';

describe('sqlite insertBatch — performance (N3)', () => {
  it('inserts 1000 records under 5 seconds', async () => {
    await init();
    const records = Array.from({ length: 1000 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `Test ${i}`,
      summary: null,
      tags: null,
      created_at: Date.now() + i,
      domain: 'example.com',
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      is_deleted: 0,
      obsidian_synced: 0,
    }));
    const start = Date.now();
    const result = await insertBatch(records);
    const elapsed = Date.now() - start;
    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });
});
```

- [ ] **Step 3.5: テスト実行して PASS を確認**

```bash
npx vitest run src/offscreen/__tests__/sqlite-perf.test.ts
```

- [ ] **Step 3.6: Commit**

```bash
git add src/offscreen/sqlite.ts src/background/migrationService.ts src/background/recordingTriggerManager.ts src/offscreen/__tests__/sqlite-perf.test.ts
git commit -m "perf(sqlite): cache prepared statements, reduce storage writes, hook onChanged (N3)

- insertBatch now prepares statement once and reuses with reset
- Wrapped insertBatch in a single BEGIN TRANSACTION / COMMIT
- MigrationService writes progress every 100 batches instead of every batch
- RecordingTriggerManager invalidates cache on storage.onChanged

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 4: N4 — 観測容易性の全面適用

**Files:**
- Modify: `src/utils/logger.ts`
- Modify: `src/background/sqliteClient.ts` (replace console.log with addLog)
- Modify: `src/offscreen/sqlite.ts` (replace console.error with addLog)
- Create: `src/background/sqliteAlert.ts` (persistent failure alerts)

- [ ] **Step 4.1: ログ規約を README に明文化**

`docs/ACCESSIBILITY.md` または新規 `docs/LOGGING.md` に以下を追加:

```markdown
# ログ規約 / Logging Conventions

## 規約
- `addLog(LogType.X, 'Component: action verb', { details })` の形式を必須
- 詳細データはオブジェクトで渡す（文字列連結禁止）
- LogType は INFO / WARN / ERROR の 3 種
- console.log / console.error は禁止
- PII（API キー、URL 全体、タイトル全体）をログに含めない

## 例
✅ addLog(LogType.INFO, 'SqliteClient: insert succeeded', { id, urlDomain: extractDomain(url) });
❌ console.log('inserted', id, url);
```

- [ ] **Step 4.2: 永続的な SQLite 障害のアラートパス追加**

`src/background/sqliteAlert.ts` 新規作成:

```typescript
import { addLog, LogType } from '../utils/logger.js';

const ALERT_THRESHOLD = 3;  // 連続 3 回失敗で通知
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;  // 1 時間 cooldown

let consecutiveFailures = 0;
let lastAlertTime = 0;

export function recordSqliteFailure(component: string, error: string): void {
  consecutiveFailures++;
  addLog(LogType.ERROR, `${component}: persistent failure`, {
    consecutiveFailures,
    error,
  });
  if (consecutiveFailures >= ALERT_THRESHOLD && Date.now() - lastAlertTime > ALERT_COOLDOWN_MS) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon-128.png'),
      title: chrome.i18n.getMessage('sqliteAlertTitle'),
      message: chrome.i18n.getMessage('sqliteAlertMessage'),
    });
    lastAlertTime = Date.now();
    consecutiveFailures = 0;
  }
}

export function recordSqliteSuccess(): void {
  consecutiveFailures = 0;
}
```

- [ ] **Step 4.3: `sqliteClient.ts` の `console.log` を `addLog` に置換**

`Grep` で `console\.log|console\.error|console\.warn` を検索し、すべて `addLog` に置換。

- [ ] **Step 4.4: `offscreen/sqlite.ts` の `console.error` を `addLog` に置換**

同様に置換。`recordSqliteSuccess` / `recordSqliteFailure` を `init` / `insert` / `query` の主要パスに組み込む。

- [ ] **Step 4.5: i18n に通知文字列追加**

```json
// _locales/ja/messages.json
"sqliteAlertTitle": { "message": "SQLite 初期化エラー" },
"sqliteAlertMessage": { "message": "履歴データベースの初期化に繰り返し失敗しています。設定の「診断」パネルを確認してください。" }
```

- [ ] **Step 4.6: テスト追加**

```bash
npx vitest run src/background/__tests__/sqliteClient.test.ts
```

- [ ] **Step 4.7: Commit**

```bash
git add src/utils/logger.ts src/background/sqliteClient.ts src/offscreen/sqlite.ts src/background/sqliteAlert.ts docs/LOGGING.md public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "obs(logging): standardize structured logging + add persistent SQLite failure alerts (N4)

- Replace all console.log/error/warn with addLog() across sqlite modules
- Add sqliteAlert module with chrome.notifications after 3 consecutive failures
- Document logging conventions in docs/LOGGING.md
- Add i18n strings for alert notification

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 5: N5 — リファクタ

**Files:**
- Modify: `src/utils/errorUtils.ts` (add `errorMessage` if missing)
- Modify: All files using `String(error)` or `error instanceof Error ? error.message : String(error)`
- Modify: `package.json` (remove duplicate wa-sqlite)

- [ ] **Step 5.1: `errorMessage` ユーティリティを確認・追加**

`src/utils/errorUtils.ts` の実装を確認。存在しなければ追加:

```typescript
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
```

- [ ] **Step 5.2: `Grep` で `String(error)` パターンを抽出**

```bash
grep -rn "String(error)" --include="*.ts" src/
```

- [ ] **Step 5.3: 各ファイルを `errorMessage` に置換**

`src/utils/errorUtils.js` を import し、`String(error)` → `errorMessage(error)`。

- [ ] **Step 5.4: `setTimeout` リーク残存箇所を `chrome.alarms` に置換**

`Grep` で `setTimeout` を全検索し、5 秒以上のタイマーを `chrome.alarms` に置換。

- [ ] **Step 5.5: `package.json` から重複 `wa-sqlite` 削除**

`package.json` を確認し、`@journeyapps/wa-sqlite` と `wa-sqlite` の両方があれば、`wa-sqlite` の方を削除。

- [ ] **Step 5.6: 検証**

```bash
npm validate
```

Expected: All tests pass

- [ ] **Step 5.7: Commit**

```bash
git add src/utils/errorUtils.ts src/ package.json
git commit -m "refactor: apply errorMessage utility, replace setTimeout with alarms, dedupe wa-sqlite (N5)

- Replace all String(error) with errorMessage(error) helper
- Convert long setTimeout calls to chrome.alarms for SW persistence
- Remove duplicate wa-sqlite entry from package.json

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 6: N6 — ドキュメント全面置換（旧ブランド名）

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: All `docs/*.md` files
- Modify: `dev-docs/blogs/*/index.md`
- Modify: `dev-docs/plans/tobe-yasumaro/pbi/*`

- [ ] **Step 6.1: 旧ブランド名パターンを `Grep` で抽出**

```bash
grep -rln "Obsidian Weave\|obsidian-weave\|Obsidian Smart History" --include="*.md" .
```

- [ ] **Step 6.2: 置換ルールに従って `sed` で一括置換**

| Before | After |
|---|---|
| `obsidian-weave` | `yasumaro` |
| `Obsidian Weave` | `Yasumaro` |
| `Obsidian Smart History` | `Yasumaro` |
| `obsidian_weave` | `yasumaro` |

ただし以下は**除外**:
- `CHANGELOG.md` の v4.x 以前（履歴保持）
- `dev-docs/CHANGELOG_before_3.md`
- `package.json` の `name` フィールド（リポジトリ名は別 PBI）
- GitHub URL（`armaniacs/obsidian-smart-history` → `armaniacs/yasumaro` は別 PBI）

- [ ] **Step 6.3: 例外処理**

```bash
# Exclude CHANGELOG.md history sections
find . -name "*.md" -not -path "./CHANGELOG.md" -not -path "./node_modules/*" -not -path "./dev-docs/CHANGELOG_before_3.md" -print0 | xargs -0 sed -i '' \
  -e 's|Obsidian Weave|Yasumaro|g' \
  -e 's|obsidian-weave|yasumaro|g' \
  -e 's|Obsidian Smart History|Yasumaro|g'
```

- [ ] **Step 6.4: 確認**

```bash
grep -rln "Obsidian Weave\|obsidian-weave\|Obsidian Smart History" --include="*.md" .
```

Expected: 残るのは CHANGELOG.md 履歴と dev-docs/CHANGELOG_before_3.md のみ

- [ ] **Step 5.5: 著者プロフィール・冒頭の個別確認**

`Grep` で残存箇所を目視確認し、適切に置換。

- [ ] **Step 5.6: Commit**

```bash
git add README.md CHANGELOG.md docs/ dev-docs/blogs/ dev-docs/plans/tobe-yasumaro/
git commit -m "docs: replace legacy brand names with yasumaro (N6)

- Obsidian Weave / obsidian-weave / Obsidian Smart History → Yasumaro / yasumaro
- Excluded CHANGELOG.md history and dev-docs/CHANGELOG_before_3.md
- Excluded GitHub URLs (separate PBI for repo rename)
- Excluded package.json name field

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 7: N7 — PII サニタイズ強化

**Files:**
- Modify: `src/background/manualContentFetcher.ts` (PII sanitize integration)
- Modify: `src/utils/piiSanitizer.ts` (multi-language patterns)
- Modify: `src/offscreen/sqlite.ts` (add purgeOldRecords)
- Modify: `docs/PRIVACY.md` (clarify retention)
- Modify: `src/background/service-worker.ts` (chrome.alarms daily purge)

- [ ] **Step 7.1: `manualContentFetcher` に PII サニタイズ統合**

`src/background/manualContentFetcher.ts` の fetch 結果に `piiSanitizer` を適用:

```typescript
import { sanitize } from '../utils/piiSanitizer.js';

export async function fetchManualContent(url: string): Promise<string> {
  const raw = await fetch(url).then((r) => r.text());
  return sanitize(raw);  // ← PII サニタイズ
}
```

- [ ] **Step 7.2: `piiSanitizer` に多言語パターン追加**

`src/utils/piiSanitizer.ts` に以下を追加:

```typescript
// English patterns
const EMAIL_EN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_EN = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const SSN_EN = /\b\d{3}-\d{2}-\d{4}\b/g;

// Chinese patterns
const PHONE_CN = /(?:\+?86[-.\s]?)?1[3-9]\d{9}/g;
const ID_CN = /\b\d{17}[\dXx]\b/g;

// Korean patterns
const PHONE_KR = /(?:\+?82[-.\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const RRN_KR = /\b\d{6}[-.\s]?[1-4]\d{6}\b/g;
```

- [ ] **Step 7.3: `purgeOldRecords` 関数を SQLite に追加**

`src/offscreen/sqlite.ts` に追加:

```typescript
export async function purgeOldRecords(retentionDays: number = 90, maxRecords: number = 1000): Promise<{ purged: number }> {
  if (!dbHandle || !sqlite3) return { purged: 0 };
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  // Delete records older than cutoff that aren't starred
  const result1 = sqlite3.exec(
    dbHandle,
    `DELETE FROM browsing_logs WHERE created_at < ${cutoffMs} AND is_starred = 0`,
  );
  // If still over maxRecords, delete oldest non-starred
  const result2 = sqlite3.exec(
    dbHandle,
    `DELETE FROM browsing_logs WHERE id IN (
      SELECT id FROM browsing_logs WHERE is_starred = 0 ORDER BY created_at ASC LIMIT MAX(0, (SELECT COUNT(*) FROM browsing_logs) - ${maxRecords})
    )`,
  );
  return { purged: result1.changes + result2.changes };
}
```

- [ ] **Step 7.4: サービスワーカーに 1 日 1 回 purge をスケジュール**

`src/background/service-worker.ts`:

```typescript
chrome.alarms.create('sqlite-purge', { periodInMinutes: 1440 });  // 24h
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sqlite-purge') {
    const result = await sqliteClient.purgeOldRecords();
    addLog(LogType.INFO, 'Daily purge completed', { purged: result.purged });
  }
});
```

- [ ] **Step 7.5: `PRIVACY.md` 更新**

保持期間（90日 / 1,000件）の実装方法を追記。

- [ ] **Step 7.6: テスト追加**

`src/utils/__tests__/piiSanitizer.test.ts` に多言語パターンのテストを追加。

- [ ] **Step 7.7: Commit**

```bash
git add src/background/manualContentFetcher.ts src/utils/piiSanitizer.ts src/offscreen/sqlite.ts src/background/service-worker.ts docs/PRIVACY.md src/utils/__tests__/piiSanitizer.test.ts
git commit -m "privacy: integrate PII sanitizer into manualContentFetcher + add multi-language patterns + retention (N7)

- Apply piiSanitizer.sanitize() to manualContentFetcher results
- Add English, Chinese, Korean PII patterns to reduce regional bias
- Add purgeOldRecords function to SQLite layer (90 days / 1000 records)
- Schedule daily purge via chrome.alarms
- Update PRIVACY.md with implementation details

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 8: N8 — 設定/保持/コスト

**Files:**
- Modify: `src/background/ai/providers/OpenAIProvider.ts` (content limit)
- Modify: `src/background/obsidianSyncService.ts` (batch sync)
- Modify: `src/offscreen/sqlite.ts` (FTS5 evaluation)
- Modify: `src/dashboard/settingsExportImport.ts` (confirmation modal)

- [ ] **Step 8.1: OpenAIProvider の content limit 調整**

`src/background/ai/providers/OpenAIProvider.ts` の `MAX_CONTENT_LENGTH` を 30,000 → 10,000 に変更。ただしユーザー設定で上書き可能に。

```typescript
const DEFAULT_MAX_CONTENT_LENGTH = 10_000;

function getMaxContentLength(settings: Record<string, unknown>): number {
  const override = settings.openAiContentLimit as number | undefined;
  return override ?? DEFAULT_MAX_CONTENT_LENGTH;
}
```

- [ ] **Step 8.2: Obsidian 同期のバッチ化**

`src/background/obsidianSyncService.ts` を新規作成（未実装の場合）または修正:

```typescript
const BATCH_SIZE = 5;
const BATCH_INTERVAL_MS = 30_000;  // 30s

async function processSyncQueue(): Promise<void> {
  const unsynced = await sqliteClient.query({ isObsidianSynced: 0, limit: BATCH_SIZE });
  if (!unsynced || unsynced.rows.length === 0) return;
  for (const row of unsynced.rows) {
    await obsidianClient.appendDailyNote(row);
    await sqliteClient.update(row.id, { obsidian_synced: 1 });
  }
}

chrome.alarms.create('obsidian-sync', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'obsidian-sync') processSyncQueue();
});
```

- [ ] **Step 8.3: FTS5 trigram インデックスの評価**

`src/offscreen/sqlite.ts` の FTS5 インデックスを計測:

```typescript
// Log a warning if the FTS index is large
const ftsCount = sqlite3.exec(dbHandle, 'SELECT COUNT(*) FROM browsing_logs_fts');
if (ftsCount[0] > 10000) {
  addLog(LogType.WARN, 'FTS index is large; consider evaluation', { count: ftsCount[0] });
}
```

ユーザーが「FTS5 削除」ボタンで削除可能にする（ダッシュボード）。

- [ ] **Step 8.4: 設定エクスポート確認モーダル**

`src/dashboard/settingsExportImport.ts` で API キー上書き時に確認モーダル表示（既存の H2 で実装した `showConfirmDialog` を再利用）。

- [ ] **Step 8.5: テスト追加**

`src/background/ai/__tests__/openaiProvider.test.ts` に content limit テストを追加。

- [ ] **Step 8.6: Commit**

```bash
git add src/background/ai/providers/OpenAIProvider.ts src/background/obsidianSyncService.ts src/offscreen/sqlite.ts src/dashboard/settingsExportImport.ts
git commit -m "cost: reduce OpenAI content limit, batch Obsidian sync, evaluate FTS5, add export confirm (N8)

- OpenAIProvider max content length: 30000 → 10000 (user-overridable)
- Obsidian sync now batches 5 records every 30s instead of per-recording
- Add FTS5 size warning at 10k records
- Settings import now confirms before overwriting API keys

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 9: 最終検証（全トラック）

- [ ] **Step 9.1: `npm validate` を実行**

```bash
npm validate
```

- [ ] **Step 9.2: 手動テスト**

- [ ] i18n 切替で全 UI が日本語/英語で表示される
- [ ] キーボードのみで全ナビゲートが可能
- [ ] 1000件の履歴で insertBatch が 5 秒以内
- [ ] SW DevTools でログが構造化されている
- [ ] 旧ブランド名が検索で CHANGELOG 履歴以外にヒットしない
- [ ] 手動フェッチで PII がマスクされる
- [ ] 90日経過した履歴が自動削除される
- [ ] 設定エクスポート取り込みで API キー上書き前に確認が出る
- [ ] Obsidian 同期がバッチで実行される

- [ ] **Step 9.3: 8 本の PR を作成**

```bash
git push origin tobe-yasumaro
gh pr create --title "fix(n1): i18n漏れ修正"
gh pr create --title "fix(n2): アクセシビリティ対応"
# ... etc
```

---

## 成功基準

- [ ] 8 トラックすべてがマージ可能
- [ ] `npm validate` 全 PR で PASS
- [ ] 総合スコア 80+ 達成
- [ ] 次回レビューで High 0 / Medium 0
