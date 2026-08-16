# ロガーflushアラーム解除復元 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ロガーのモジュール分割リファクタで消失した「バッファフラッシュ後にスケジュール済みアラームを解除する」処理を復元する。

**Architecture:** `LogFlushScheduler`インターフェース（`src/utils/logger/flushScheduler.ts`）に`clear()`メソッドを追加し、`ChromeAlarmFlushScheduler`で`chrome.alarms.clear`を呼ぶ実装、`ImmediateFlushScheduler`でno-op実装を用意する。`src/utils/logger/core.ts`の`persistPending()`の`finally`ブロックと`clearLogs()`から`scheduler.clear()`を呼ぶ。

**Tech Stack:** TypeScript, Vitest（`environment: 'node'`, `globals: true`）

---

## 事前に必ず読むこと

1. **テストランナーはVitestです。**
2. **`chrome.alarms`のモックは`testDir/vitest.setup.ts`に既にあります。** `chrome.alarms.clear`は`vi.fn`でモック済みなので、テストでは`vi.spyOn`や`toHaveBeenCalledWith`でそのまま検証できます。
3. **`persistPending()`の`isFlushing`チェック（`src/utils/logger/core.ts:25`）は`try`ブロックの外側にあります。** つまり`finally`ブロックに新しい処理を追加しても、「既に他の呼び出しがフラッシュ中だったので何もしなかった」ケースには影響しません。

---

## Task 1: 既存コードを確認する

**Files:**
- Read（変更しない）: `src/utils/logger/flushScheduler.ts`
- Read（変更しない）: `src/utils/logger/core.ts:1-105`
- Read（変更しない）: `src/utils/__tests__/flushScheduler.test.ts`

- [ ] **Step 1: `flushScheduler.ts`の現在の内容を確認する**

```bash
cat src/utils/logger/flushScheduler.ts
```

以下の内容が表示されます:

```typescript
const LOGGER_ALARM_NAME = 'yasumaro-logger-flush';
const BATCH_FLUSH_ALARM_MINUTES = 1;

export interface LogFlushScheduler {
  onFlushRequested(handler: () => Promise<void>): void;
  schedule(): void;
  flushNow(): Promise<void>;
}

export class ChromeAlarmFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;

  onFlushRequested(handler: () => Promise<void>): void {
    // ... （chrome.alarms.onAlarm と chrome.runtime.onSuspend のリスナー登録）
  }

  schedule(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.create(LOGGER_ALARM_NAME, { delayInMinutes: BATCH_FLUSH_ALARM_MINUTES });
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}

export class ImmediateFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;

  onFlushRequested(handler: () => Promise<void>): void {
    this.handler = handler;
  }

  schedule(): void {
    void this.handler?.();
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}
```

**問題点**: `schedule()`（アラームを作る）はあるが、対になる「アラームを消す」メソッドがない。

- [ ] **Step 2: `core.ts`で`scheduler`がどう使われているか確認する**

```bash
sed -n '1,50p' src/utils/logger/core.ts
```

以下のような構造です:

```typescript
const scheduler: LogFlushScheduler = new ChromeAlarmFlushScheduler();
let isFlushing = false;

async function persistPending(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const entries = buffer.drain();
    if (entries.length === 0) return;
    if (typeof chrome === 'undefined' || !chrome.storage) {
      for (const log of entries) { console.log(...); }
      return;
    }
    await storage.append(entries);
  } catch (e) {
    console.error('Logger: Failed to flush logs', e);
  } finally {
    isFlushing = false;
  }
}

scheduler.onFlushRequested(() => persistPending());

export async function addLog(...): Promise<void> {
  // ...
  buffer.push(entry);
  if (buffer.size() >= BATCH_FLUSH_SIZE) {
    await persistPending();
  } else {
    scheduler.schedule();
  }
}

export async function clearLogs(): Promise<void> {
  buffer.clear();
  await storage.clear();
}
```

**なぜ`finally`に`clear()`を追加するのが正しいか**: `isFlushing`のチェック（`if (isFlushing) return;`）は`try`ブロックより**前**にあります。つまり「既に他の呼び出しがフラッシュ中」の場合はそもそも`try`ブロックに入らず、`finally`も実行されません。そのため、`finally`に`scheduler.clear()`を追加しても、「他の呼び出しが実行中だから何もしなかった」ケースには影響せず、「実際にフラッシュ処理を試みた」ケース（成功・空バッファ・offscreen環境・例外、いずれも）でのみ`clear()`が呼ばれます。これはPBIが求める「フラッシュ後はアラームを解除する」という振る舞いに正確に合致します。

- [ ] **Step 3: 既存テストを確認する**

```bash
cat src/utils/__tests__/flushScheduler.test.ts
```

以下の内容が表示されます:

```typescript
import { ImmediateFlushScheduler } from '../logger/flushScheduler.js';

describe('ImmediateFlushScheduler', () => {
  it('invokes the registered handler immediately on schedule', async () => {
    const scheduler = new ImmediateFlushScheduler();
    let called = 0;
    scheduler.onFlushRequested(() => { called++; return Promise.resolve(); });
    scheduler.schedule();
    expect(called).toBe(1);
  });

  it('flushNow triggers the handler', async () => {
    const scheduler = new ImmediateFlushScheduler();
    let called = 0;
    scheduler.onFlushRequested(() => { called++; return Promise.resolve(); });
    await scheduler.flushNow();
    expect(called).toBe(1);
  });
});
```

**このテストで分かること**: `ImmediateFlushScheduler`のテストパターンが分かります。今回の変更では、このファイルに`ChromeAlarmFlushScheduler`の`clear()`のテストも追加します。

（このタスクは調査のみです。コミット不要です。）

---

## Task 2: 失敗するテストを書く

**Files:**
- Modify: `src/utils/__tests__/flushScheduler.test.ts`

- [ ] **Step 1: `ChromeAlarmFlushScheduler.clear()`のテストを追加する**

`src/utils/__tests__/flushScheduler.test.ts`の内容を、以下のように書き換えてください（既存の`import`とテストはそのまま残し、新しい`import`と`describe`ブロックを追加します）。

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImmediateFlushScheduler, ChromeAlarmFlushScheduler } from '../logger/flushScheduler.js';

describe('ImmediateFlushScheduler', () => {
  it('invokes the registered handler immediately on schedule', async () => {
    const scheduler = new ImmediateFlushScheduler();
    let called = 0;
    scheduler.onFlushRequested(() => { called++; return Promise.resolve(); });
    scheduler.schedule();
    expect(called).toBe(1);
  });

  it('flushNow triggers the handler', async () => {
    const scheduler = new ImmediateFlushScheduler();
    let called = 0;
    scheduler.onFlushRequested(() => { called++; return Promise.resolve(); });
    await scheduler.flushNow();
    expect(called).toBe(1);
  });

  it('clear does not throw (no-op fake, no real alarm to clear)', () => {
    const scheduler = new ImmediateFlushScheduler();
    expect(() => scheduler.clear()).not.toThrow();
  });
});

describe('ChromeAlarmFlushScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an alarm named yasumaro-logger-flush on schedule', () => {
    const scheduler = new ChromeAlarmFlushScheduler();
    scheduler.schedule();
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'yasumaro-logger-flush',
      expect.objectContaining({ delayInMinutes: 1 })
    );
  });

  it('clears the same alarm it schedules', () => {
    const scheduler = new ChromeAlarmFlushScheduler();
    scheduler.clear();
    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-logger-flush');
  });
});
```

**なぜ`LOGGER_ALARM_NAME`（`'yasumaro-logger-flush'`）を文字列リテラルで直接書くか**: この定数は`flushScheduler.ts`内で`export`されていない（モジュール内プライベート）ため、テストから直接参照できません。実際の文字列値をテストに直書きします。もし将来この定数名や値が変わった場合、このテストの文字列も合わせて更新する必要があります。

- [ ] **Step 2: テストを実行し、失敗することを確認する**

```bash
npx vitest run src/utils/__tests__/flushScheduler.test.ts
```

**期待される結果**: `clear does not throw`と`clears the same alarm it schedules`の2つのテストが失敗する（`scheduler.clear is not a function`のようなエラー）。他の既存3テストは成功したままのはずです。

- [ ] **Step 3: コミットする**

```bash
git add src/utils/__tests__/flushScheduler.test.ts
git commit -m "test(logger): add failing test for missing scheduler.clear()"
```

---

## Task 3: `LogFlushScheduler`に`clear()`を実装する

**Files:**
- Modify: `src/utils/logger/flushScheduler.ts`

- [ ] **Step 1: インターフェースと両実装に`clear()`を追加する**

`src/utils/logger/flushScheduler.ts`の内容全体を、以下のように書き換えてください。

```typescript
const LOGGER_ALARM_NAME = 'yasumaro-logger-flush';
const BATCH_FLUSH_ALARM_MINUTES = 1;

export interface LogFlushScheduler {
  onFlushRequested(handler: () => Promise<void>): void;
  schedule(): void;
  /** Cancel a pending scheduled flush (e.g. after a flush already ran). */
  clear(): void;
  flushNow(): Promise<void>;
}

/** Chrome runtime implementation — uses chrome.alarms + onSuspend */
export class ChromeAlarmFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;

  onFlushRequested(handler: () => Promise<void>): void {
    this.handler = handler;
    if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === LOGGER_ALARM_NAME) void this.handler?.();
      });
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
      chrome.runtime.onSuspend.addListener(async () => {
        const flushCompleted = await Promise.race([
          this.flushNow().then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
        ]);
        if (!flushCompleted) {
          console.error(
            '[Logger] Flush timed out during suspend — pending log entries may not have been persisted'
          );
        }
      });
    }
  }

  schedule(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.create(LOGGER_ALARM_NAME, { delayInMinutes: BATCH_FLUSH_ALARM_MINUTES });
  }

  clear(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.clear(LOGGER_ALARM_NAME);
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}

/** Test fake — runs handler synchronously/immediately */
export class ImmediateFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;

  onFlushRequested(handler: () => Promise<void>): void {
    this.handler = handler;
  }

  schedule(): void {
    void this.handler?.();
  }

  clear(): void {
    // No real alarm exists in this fake — nothing to cancel.
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}
```

**変更点**: `LogFlushScheduler`インターフェースに`clear(): void;`を追加し、`ChromeAlarmFlushScheduler`は`schedule()`と対称的に`chrome.alarms.clear(LOGGER_ALARM_NAME)`を呼び、`ImmediateFlushScheduler`は何もしない実装（コメントのみのメソッド本体）にしました。

- [ ] **Step 2: 型チェックを実行する**

```bash
npm run type-check
```

**期待される結果**: エラーなく終了すること。

- [ ] **Step 3: テストを実行し、グリーンになることを確認する**

```bash
npx vitest run src/utils/__tests__/flushScheduler.test.ts
```

**期待される結果**: 5つ全てのテストが成功すること。

- [ ] **Step 4: コミットする**

```bash
git add src/utils/logger/flushScheduler.ts
git commit -m "feat(logger): add clear() to LogFlushScheduler interface"
```

---

## Task 4: `core.ts`から`clear()`を呼び出す

**Files:**
- Modify: `src/utils/logger/core.ts`
- Test: `src/utils/__tests__/coreOrchestrator.test.ts`（存在すれば確認、必要なら追加）

- [ ] **Step 1: 既存の`coreOrchestrator.test.ts`の内容（確認済み）**

このファイルは以下の内容です（確認済みなので`cat`は不要です、そのまま次に進んでください）。

```typescript
import { addLog, getLogs, clearLogs } from '../logger/core.js';

describe('core orchestrator', () => {
  beforeEach(async () => {
    await clearLogs();
  });

  it('addLog pushes to buffer and getLogs returns the entry', async () => {
    await addLog('INFO', 'hello');
    const logs = await getLogs();
    expect(logs.some((l) => l.message === 'hello')).toBe(true);
  });
});
```

**重要な事実**:
- importは`../logger/core.js`から行われています（`../logger.js`ではありません）。今回追加するテストも同じimport元を使います。
- `flushLogs`はこのファイルではまだimportされていません。Task 4のテストで新たにimportに追加する必要があります。
- `LogType`はimportされておらず、`addLog`の第一引数には`'INFO'`という文字列リテラルがそのまま渡されています（型は`LogTypeValues`ですが、文字列リテラルもそのまま代入可能です）。今回追加するテストでも同じスタイル（文字列リテラル）を使います。

- [ ] **Step 2: `persistPending()`の`finally`に`scheduler.clear()`を追加する**

`src/utils/logger/core.ts`の`persistPending`関数を以下のように書き換えてください。

変更前:

```typescript
async function persistPending(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const entries = buffer.drain();
    if (entries.length === 0) return;

    if (typeof chrome === 'undefined' || !chrome.storage) {
      for (const log of entries) {
        console.log(`[Logger:${log.type}] ${log.message}`, log.details || '');
      }
      return;
    }

    await storage.append(entries);
  } catch (e) {
    console.error('Logger: Failed to flush logs', e);
  } finally {
    isFlushing = false;
  }
}
```

変更後:

```typescript
async function persistPending(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const entries = buffer.drain();
    if (entries.length === 0) return;

    if (typeof chrome === 'undefined' || !chrome.storage) {
      for (const log of entries) {
        console.log(`[Logger:${log.type}] ${log.message}`, log.details || '');
      }
      return;
    }

    await storage.append(entries);
  } catch (e) {
    console.error('Logger: Failed to flush logs', e);
  } finally {
    // A scheduled alarm may still be pending even though we just flushed
    // (e.g. addLog reached BATCH_FLUSH_SIZE before the alarm fired). Clear
    // it so it doesn't fire again later and run an unnecessary empty flush.
    scheduler.clear();
    isFlushing = false;
  }
}
```

**なぜ`scheduler.clear()`を`isFlushing = false`より前に置くか**: 実際にはどちらが先でも動作は変わりません（両方とも`finally`ブロック内の同期的な処理です）。今回は「フラッシュ処理の後片付け」という意味的なまとまりで`scheduler.clear()`を先に書いていますが、順序に技術的な制約はありません。

- [ ] **Step 3: `clearLogs()`にも`scheduler.clear()`を追加する**

`src/utils/logger/core.ts`の`clearLogs`関数を確認してください。

```bash
grep -n "export async function clearLogs" -A5 src/utils/logger/core.ts
```

以下のように書き換えてください。

変更前:

```typescript
export async function clearLogs(): Promise<void> {
  buffer.clear();
  await storage.clear();
}
```

変更後:

```typescript
export async function clearLogs(): Promise<void> {
  buffer.clear();
  await storage.clear();
  scheduler.clear();
}
```

- [ ] **Step 4: 型チェックを実行する**

```bash
npm run type-check
```

**期待される結果**: エラーなく終了すること。

- [ ] **Step 5: このタスク用のテストを書く**

`src/utils/__tests__/coreOrchestrator.test.ts`の内容全体を、以下のように書き換えてください（`import`文に`flushLogs`を追加し、新しい`describe`ブロックを既存の`describe`ブロックの後に追加します）。

```typescript
import { addLog, getLogs, clearLogs, flushLogs } from '../logger/core.js';

describe('core orchestrator', () => {
  beforeEach(async () => {
    await clearLogs();
  });

  it('addLog pushes to buffer and getLogs returns the entry', async () => {
    await addLog('INFO', 'hello');
    const logs = await getLogs();
    expect(logs.some((l) => l.message === 'hello')).toBe(true);
  });
});

describe('flush alarm lifecycle', () => {
  beforeEach(async () => {
    await clearLogs();
    vi.clearAllMocks();
  });

  it('clears the scheduled alarm after a successful flush', async () => {
    await addLog('INFO', 'test message 1');
    // BATCH_FLUSH_SIZE に満たない場合は addLog が scheduler.schedule() を
    // 呼ぶだけでまだ flush されない。flushLogs(true) で明示的にフラッシュする。
    await flushLogs(true);

    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-logger-flush');
  });

  it('clears the scheduled alarm when clearLogs is called', async () => {
    await clearLogs();

    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-logger-flush');
  });
});
```

**なぜ`beforeEach`の中で`clearLogs()`を先に呼ぶか**: 既存の`describe('core orchestrator', ...)`ブロックと同じパターンに合わせています。前のテストで溜まったバッファやストレージの内容が次のテストに影響しないようにするためです。`vi.clearAllMocks()`は`chrome.alarms.clear`が「このテストの中で」呼ばれたかどうかを正確に検証するため、前のテストでの呼び出し回数をリセットする目的で追加しています。

- [ ] **Step 6: テストを実行する**

```bash
npx vitest run src/utils/__tests__/coreOrchestrator.test.ts
```

**期待される結果**: 追加した2テストを含め全て成功すること。

もし失敗する場合、よくある原因:
- `chrome.alarms.clear`が呼ばれた回数を`vi.clearAllMocks()`でリセットし忘れている（前のテストの呼び出し回数が残っている）
- `addLog`だけでは`persistPending`が呼ばれない（`BATCH_FLUSH_SIZE`未満のため）。`flushLogs(true)`を明示的に呼ぶ必要がある

- [ ] **Step 7: コミットする**

```bash
git add src/utils/logger/core.ts src/utils/__tests__/coreOrchestrator.test.ts
git commit -m "fix(logger): clear scheduled flush alarm after flush and on clearLogs"
```

---

## Task 5: 既存テストへの影響を確認する

**Files:**
- Read/Run（変更しない）: プロジェクト全体のロガー関連テスト

- [ ] **Step 1: ロガー関連の全テストを実行する**

```bash
npx vitest run src/utils/__tests__/logCritical.test.ts src/utils/__tests__/flushScheduler.test.ts src/utils/__tests__/coreOrchestrator.test.ts src/utils/__tests__/logger-enhanced.test.ts src/utils/__tests__/logger-production.test.ts src/utils/__tests__/logger-security.test.ts src/utils/__tests__/logger-source.test.ts
```

**期待される結果**: 全て成功すること。

- [ ] **Step 2: プロジェクト全体のテストと型チェックを実行する**

```bash
npm run validate
```

**期待される結果**: 全て成功すること。

---

## Task 6: PBIをDONEとしてアーカイブする

**Files:**
- Modify: `pbi/00-INDEX.md`
- Move: `pbi/2026-08-13-04-fix-logger-flush-alarm-not-cleared.md` → `dev-docs/archived/pbi/`

- [ ] **Step 1: PBIファイルをアーカイブディレクトリへ移動する**

```bash
mkdir -p dev-docs/archived/pbi
git mv pbi/2026-08-13-04-fix-logger-flush-alarm-not-cleared.md dev-docs/archived/pbi/
```

- [ ] **Step 2: `pbi/00-INDEX.md`を更新する**

```markdown
- 2026-08-13-04-fix-logger-flush-alarm-not-cleared.md (LogFlushSchedulerにclear()追加、persistPending成功時とclearLogsでスケジュール済みアラームを解除)
```

- [ ] **Step 3: コミットする**

```bash
git add pbi/00-INDEX.md dev-docs/archived/pbi/2026-08-13-04-fix-logger-flush-alarm-not-cleared.md
git commit -m "docs(pbi): archive completed logger-flush-alarm-not-cleared PBI"
```

---

## 完了チェックリスト

- [ ] `npx vitest run src/utils/__tests__/flushScheduler.test.ts` がグリーン（5テスト）
- [ ] `npx vitest run src/utils/__tests__/coreOrchestrator.test.ts` がグリーン
- [ ] `npm run validate`（型チェック＋全テスト）がグリーン
- [ ] `pbi/00-INDEX.md`が更新され、PBIがアーカイブされている
