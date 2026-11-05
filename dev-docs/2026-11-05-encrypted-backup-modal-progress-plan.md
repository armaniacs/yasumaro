# Encrypted Backup Modal Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** パスワードモーダル内にバックアップ進捗・処理中・失敗理由を必ず表示する。

**Architecture:** 認証モーダルが進捗領域を所有し、パネル側の既存 `onStage` コールバックが背後 status とモーダル進捗の両方に同文言を出す。サービス層・KDF・gateway契約は不変。観測は `logDebug` の最小付加に限定する。

**Tech Stack:** TypeScript (nodeNext, `.js` ESM), Chrome MV3 dashboard (options page), Vitest + jsdom, i18n `getMessageOr`, logger seam `logDebug`.

**Spec:** `dev-docs/2026-11-05-encrypted-backup-modal-progress-design.md` (承認済み。既定場所 `docs/superpowers/plans/` は本リポジトリで gitignore のため `dev-docs/` 直下に配置する)。

---

## File Structure

- Modify: `entrypoints/options/index.html:2768-2782` ― `passwordAuthModal` の `modal-body` に進捗 `div` を1点追加する。責任: 進捗の表示場所の提供のみ。
- Modify: `src/dashboard/masterPassword.ts` ― `MasterPasswordController` に進捗所有を持たせる。責任: モーダル内進捗・ビジー状態の所有と切替え。`authenticatePassword` の実行中は必ず busy 表示にする。
- Modify: `src/dashboard/encryptedBackupPanel.ts` ― 既存 `onStage` からモーダル進捗への転送と最小計測。責任: 段階文言の解決と二面描画（背後＋モーダル）。
- Test: `src/dashboard/__tests__/masterPassword-branches.test.ts` ― 進捗・ビジーの振る舞いを追加する。
- Test: `src/dashboard/__tests__/encryptedBackupPanel.test.ts` ― stage転送の assertion を追加する。
- No change: `src/dashboard/encryptedBackupService.ts`, `src/messaging/*`, `src/utils/crypto/*`.

---

### Task 1: モーダル進捗シームの失敗テストを書く

**Files:**
- Modify: `src/dashboard/__tests__/masterPassword-branches.test.ts`
- Test: `src/dashboard/__tests__/masterPassword-branches.test.ts`

既存の `MasterPasswordController` テストの DOM 構築部に `passwordAuthProgress` を足し、新メソッドの存在と振る舞いを先に固定する。この時点では実装がないため失敗する。

- [ ] **Step 1: Write the failing test**

既存テストファイルの DOM セットアップに1行足し、新しい `describe` を末尾に追加する:

```ts
// 既存の setDom ヘルパー内に追加する1行
document.body.innerHTML += `<div id="passwordAuthProgress" role="status" aria-live="polite"></div>`;
```

```ts
describe('password auth modal progress (2026-11-05)', () => {
  it('exposes progress text and busy state on the auth modal', async () => {
    const { MasterPasswordController } = await import('../masterPassword.js');
    document.body.innerHTML = `
      <div id="passwordAuthModal" class="hidden">
        <input id="masterPasswordAuthInput" type="password" />
        <div id="passwordAuthError"></div>
        <div id="passwordAuthProgress" role="status" aria-live="polite"></div>
        <button id="closePasswordAuthModalBtn"></button>
        <button id="cancelPasswordAuthBtn"></button>
        <button id="submitPasswordAuthBtn">Confirm</button>
      </div>
    `;
    const controller = new MasterPasswordController();
    controller.setPasswordAuthProgress('履歴DBを読み出しています...');
    expect(document.getElementById('passwordAuthProgress')!.textContent)
      .toBe('履歴DBを読み出しています...');
    controller.setPasswordAuthBusy(true);
    expect((document.getElementById('submitPasswordAuthBtn') as HTMLButtonElement).disabled).toBe(true);
    controller.setPasswordAuthBusy(false);
    expect((document.getElementById('submitPasswordAuthBtn') as HTMLButtonElement).disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/dashboard/__tests__/masterPassword-branches.test.ts -t "exposes progress text" 2>&1 | tail -15`
Expected: FAIL with `controller.setPasswordAuthProgress is not a function` (または `Property 'setPasswordAuthProgress' does not exist`)。型エラーでもよい。失敗を確認したら次に進む。

---

### Task 2: `MasterPasswordController` に進捗・ビジーを実装する

**Files:**
- Modify: `src/dashboard/masterPassword.ts`

`MasterPasswordDomRefs` に所有を追加し、表示・クリア・ビジー切替え・既存フローへの結線を一括で行う。これが本機能の中心である。

- [ ] **Step 1: Add the DOM ref**

```ts
export interface MasterPasswordDomRefs {
  // ... existing fields ...
  passwordAuthError: HTMLElement | null;
  passwordAuthProgress: HTMLElement | null; // 追加
  // ... rest ...
}
```

```ts
passwordAuthProgress: document.getElementById('passwordAuthProgress') as HTMLElement | null,
```

- [ ] **Step 2: Add the two public methods inside MasterPasswordController**

```ts
setPasswordAuthProgress(message: string | null): void {
  if (!this.dom.passwordAuthProgress) return;
  this.dom.passwordAuthProgress.textContent = message ?? '';
  this.dom.passwordAuthProgress.classList.toggle('hidden', message == null || message === '');
}

setPasswordAuthBusy(busy: boolean): void {
  const submitBtn = this.dom.submitPasswordAuthBtn;
  const input = this.dom.masterPasswordAuthInput;
  if (submitBtn) {
    if (busy) {
      submitBtn.dataset.label = submitBtn.textContent ?? '';
      submitBtn.disabled = true;
      submitBtn.textContent = getMessageOr('processing', 'Processing...');
    } else {
      submitBtn.disabled = false;
      const label = submitBtn.dataset.label;
      if (label !== undefined && label !== '') {
        submitBtn.textContent = label;
        delete submitBtn.dataset.label;
      } else {
        submitBtn.textContent = getMessage('confirm');
      }
    }
  }
  if (input) input.disabled = busy;
}
```

注意: `getMessage` / `getMessageOr` は当ファイルで既に import 済みである。新規 import は不要である。

- [ ] **Step 3: Wire into show / close / authenticate**

`showPasswordAuthModal` の末尾に2行足す:

```ts
this.setPasswordAuthProgress(null);
this.setPasswordAuthBusy(false);
```

`closePasswordAuthModal` の末尾に2行足す:

```ts
this.setPasswordAuthProgress(null);
this.setPasswordAuthBusy(false);
```

`authenticatePassword` の変更点は3か所である。検証開始直後（レート制限通過・`verifyMasterPasswordWithRehash` の前）に次を入れる:

```ts
this.setPasswordAuthBusy(true);
this.setPasswordAuthProgress(getMessageOr('masterPasswordStageRotating', 'Verifying...'));
```

`const result = await verifyMasterPasswordWithRehash(password);` の失敗分岐（`else` 側）の先頭に次を入れる:

```ts
this.setPasswordAuthBusy(false);
this.setPasswordAuthProgress(null);
```

成功側の `try` の `finally` は既存の `submitBtn.disabled = false` を `this.setPasswordAuthBusy(false)` に置き換える。`catch (e)` 側では進捗を残す（失敗段階で停止の仕様）が、エラー文の設定は従来通り `passwordAuthError` に行う。成功 close の直前に `this.setPasswordAuthProgress(null)` を入れる。

- [ ] **Step 4: Add backward-compatible exports at the bottom of the file**

```ts
export function setPasswordAuthProgress(message: string | null): void {
  getOrCreateController().setPasswordAuthProgress(message);
}

export function setPasswordAuthBusy(busy: boolean): void {
  getOrCreateController().setPasswordAuthBusy(busy);
}
```

- [ ] **Step 5: Run the Task 1 test to verify it passes**

Run: `npx vitest run src/dashboard/__tests__/masterPassword-branches.test.ts 2>&1 | tail -8`
Expected: PASS（全件）。失敗したら Task 2 の編集を見直す。複数箇所を同時に追加修正しない。

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/masterPassword.ts src/dashboard/__tests__/masterPassword-branches.test.ts
git commit -m "feat: パスワード認証モーダルに進捗とビジー表示を追加"
```

---

### Task 3: パネル側からモーダル進捗への転送と最小計測を実装する

**Files:**
- Modify: `src/dashboard/encryptedBackupPanel.ts`
- Test: `src/dashboard/__tests__/encryptedBackupPanel.test.ts`

段階文言の解決はパネル側に残し、モーダル側には解決済み文字列だけを渡す。計測は `logDebug` に限定し、秘密・パスワードは記録しない。

- [ ] **Step 1: Write the failing test**

`encryptedBackupPanel.test.ts` の `setDom` に1行足す:

```ts
document.body.innerHTML = `
  <button id="exportEncryptedBackupBtn"></button>
  <button id="importEncryptedBackupBtn"></button>
  <input type="file" id="importEncryptedBackupFileInput" />
  <div id="encryptedBackupStatus"></div>
  <div id="passwordAuthProgress" role="status" aria-live="polite"></div>
`;
```

次のテストを `describe('initEncryptedBackupPanel')` 内に追加する:

```ts
it('forwards export stages to the auth modal progress', async () => {
  const stages: string[] = [];
  vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
    void action('my-password');
  });
  vi.mocked(exportEncryptedBackup).mockImplementation(async (_pw, onStage) => {
    onStage?.('readingDb');
    onStage?.('encrypting');
    return { version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd' };
  });
  const { setPasswordAuthProgress } = await import('../masterPassword.js');
  void setPasswordAuthProgress;
  initEncryptedBackupPanel();
  document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));
  await vi.waitFor(() => {
    expect(exportEncryptedBackup).toHaveBeenCalled();
  });
  await Promise.resolve();
  const progress = document.getElementById('passwordAuthProgress')!.textContent ?? '';
  expect(progress.length).toBeGreaterThan(0);
  expect(stages.length).toBeGreaterThanOrEqual(0);
});
```

注: `showPasswordAuthModal` は当テストでモックされているため、転送の実線は `exportEncryptedBackup` の `onStage` がパネル実装内で `setPasswordAuthProgress` を呼ぶことで成立する。モック下で `passwordAuthProgress` が空のままなら失敗する。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/dashboard/__tests__/encryptedBackupPanel.test.ts -t "forwards export stages" 2>&1 | tail -12`
Expected: FAIL（進捗が空）。通過してしまう場合はモックが実モジュールを呼んでいる疑いがあるため、`vi.mock('../masterPassword.js')` の有無を確認する。

- [ ] **Step 3: Write minimal implementation**

ファイル先頭の import に2行足す:

```ts
import { setPasswordAuthProgress } from './masterPassword.js';
import { logDebug } from '../utils/logger/api.js';
```

export 側の `onStage` コールバックを次に置き換える。既存の `setStatus` は残し、その直後にモーダル転送を足す:

```ts
const startedAt = Date.now();
const envelope = await exportEncryptedBackup(password, (stage) => {
  const text =
    stage === 'readingDb'
      ? getMessageOr('backupStageReadingDb', 'Reading history database...')
      : getMessageOr('backupStageEncrypting', 'Encrypting...');
  setStatus(text, false, 'updating');
  setPasswordAuthProgress(text);
  void logDebug('encrypted-backup stage', { flow: 'export', stage, elapsedMs: Date.now() - startedAt }, 'encryptedBackupPanel');
});
setPasswordAuthProgress(null);
void logDebug(
  'encrypted-backup done',
  { flow: 'export', elapsedMs: Date.now() - startedAt, envelopeChars: JSON.stringify(envelope).length },
  'encryptedBackupPanel',
);
```

import 側も同様に置き換える:

```ts
const startedAt = Date.now();
const result = await importEncryptedBackup(parsed, password, (stage) => {
  const text =
    stage === 'decrypting'
      ? getMessageOr('backupStageDecrypting', 'Decrypting...')
      : stage === 'restoringDb'
        ? getMessageOr('backupStageRestoringDb', 'Restoring history database...')
        : getMessageOr('backupStageRestoringSettings', 'Restoring settings...');
  setStatus(text, false, 'updating');
  setPasswordAuthProgress(text);
  void logDebug('encrypted-backup stage', { flow: 'import', stage, elapsedMs: Date.now() - startedAt }, 'encryptedBackupPanel');
});
setPasswordAuthProgress(null);
```

失敗時（`result.success === false` または catch）は進捗を残すため `setPasswordAuthProgress(null)` を呼ばない。成功時のみクリアする。既存の `passwordAuthError` 経路・`encryptedBackupStatus` 経路は変えない。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/dashboard/__tests__/encryptedBackupPanel.test.ts 2>&1 | tail -8`
Expected: PASS（全件）。`masterPassword.js` のモックに `setPasswordAuthProgress` がない場合はテストのモック定義に `setPasswordAuthProgress: vi.fn()` を追加する（実装ではなくテスト側の不足である）。

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/encryptedBackupPanel.ts src/dashboard/__tests__/encryptedBackupPanel.test.ts
git commit -m "feat: バックアップ段階を認証モーダルに転送し計測を追加"
```

---

### Task 4: 認証モーダル HTML に進捗領域を追加する

**Files:**
- Modify: `entrypoints/options/index.html:2772-2776`

ロジック変更なし。表示場所の提供のみである。

- [ ] **Step 1: Edit the HTML**

```html
<div class="form-group">
  <label for="masterPasswordAuthInput" data-i18n="masterPassword">Master Password</label>
  <input type="password" id="masterPasswordAuthInput" autocomplete="current-password">
</div>
<div id="passwordAuthProgress" class="auth-progress hidden" role="status" aria-live="polite"></div>
<div id="passwordAuthError" class="field-error" role="alert"></div>
```

`hidden` クラスは `setPasswordAuthProgress` の toggle と対応する。CSS 追加は行わない（既存の `field-error`・`status-message` の見た目に従い、不可視制御のみ `hidden` で行う）。

- [ ] **Step 2: Verify no i18n regression**

Run: `npm run check-i18n 2>&1 | tail -5`
Expected: `PASS` または `All checks passed`。新規 i18n キーは使っていないため、失敗したら既存キーの破損を疑う。

- [ ] **Step 3: Commit**

```bash
git add entrypoints/options/index.html
git commit -m "feat: 認証モーダルに進捗表示領域を追加"
```

---

### Task 5: ゲート検証と手動確認

**Files:** 変更なし（検証のみ）。

- [ ] **Step 1: Run type check**

Run: `npm run type-check 2>&1 | tail -5`
Expected: エラーなし。`MasterPasswordDomRefs` の新規 field や export 関数の型不一致が出たら Task 2 に戻る。

- [ ] **Step 2: Run the two affected suites**

Run: `npx vitest run src/dashboard/__tests__/encryptedBackupPanel.test.ts src/dashboard/__tests__/masterPassword-branches.test.ts 2>&1 | tail -8`
Expected: 全 PASS。

- [ ] **Step 3: Run lint on changed sources**

Run: `npx eslint src/dashboard/masterPassword.ts src/dashboard/encryptedBackupPanel.ts 2>&1 | tail -5`
Expected: 出力なし（クリーン）。

- [ ] **Step 4: Run docs charset check**

Run: `node scripts/check-docs-chars.mjs 2>&1 | tail -3`
Expected: `0 with violations`。

- [ ] **Step 5: Manual verification (real browser, 1回ずつ)**

1. `npm run build` 後に `chrome://extensions` で dist を読み込む。
2. ダッシュボードの「エクスポート / インポート」→「暗号化バックアップを作成」→パスワード入力→「確認」。
3. モーダル内で「履歴DBを読み出しています...」→「暗号化しています...」の切替えとボタンの「処理中...」化を確認し、ダウンロードされることを確認する。
4. 復元も同様に「復号しています...」→「履歴DBを復元しています...」→「設定を復元しています...」を確認する。
5. 誤パスワードで失敗理由がモーダル内に残り、進捗が失敗段階で止まることを確認する。

---

## Self-Review

- Spec 1章（段階・処理中・失敗理由のモーダル内表示）→ Task 2・3・4 が実装する。
- Spec 2章（Envelope/KDF/タイムアウト不変）→ どの Task も触らない。計測のみで契約変更なし。
- Spec 3章（状態遷移）→ Task 2 の busy＋progress＋close/clear が対応する。失敗時残留は Task 3 のクリア条件で対応する。
- Spec 4章（3ファイルのみ変更）→ Task 2・3・4 の範囲と一致する。service・messaging・crypto に触らない。
- Spec 5章（エラー処理）→ Task 2 の分岐と Task 3 のクリア条件が対応する。
- Spec 6章（テスト）→ Task 1・3 が先に失敗テストを置き、Task 5 がゲートと手動確認を行う。
- プレースホルダなし（TBD/TODO・「適切に」等の丸投げ表現なし。コード・コマンド・期待結果を完備）。
- 型整合: `setPasswordAuthProgress(message: string | null)` と `setPasswordAuthBusy(busy: boolean)` の署名は全 Task で同一。`MasterPasswordDomRefs.passwordAuthProgress` の所有と `getElementById('passwordAuthProgress')` の ID は Task 2 と Task 4 で一致する。
