# マスターパスワードUI統合 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `popup/masterPasswordUi.ts` と `dashboard/masterPassword.ts` の重複ロジックを `src/utils/masterPasswordUiCore.ts` に抽出し、各UIはDOM操作とモーダル表示の差異分のみを担当する薄いアダプターにする

**Architecture:** 共有コアモジュールにビジネスロジック（バリデーション、パスワード設定/認証、設定読み込み）を抽出。各UIはDOM要素の参照とモーダル開閉（dialog vs div+focusTrap）のみを提供するアダプターとして振る舞う。

**Tech Stack:** TypeScript, Vitest, 既存の `masterPassword.js`, `rateLimiter.js`, `i18n.js`

---

## ファイルマッピング

| 操作 | ファイル |
|------|---------|
| 作成 | `src/utils/masterPasswordUiCore.ts` |
| 変更 | `src/popup/masterPasswordUi.ts` |
| 変更 | `src/dashboard/masterPassword.ts` |
| 作成 | `src/utils/__tests__/masterPasswordUiCore.test.ts` |

---

### Task 1: `masterPasswordUiCore.ts` に共有バリデーション関数を抽出

**Files:**
- Create: `src/utils/masterPasswordUiCore.ts`

- [ ] **Step 1: テストを書く**

`src/utils/__tests__/masterPasswordUiCore.test.ts` を作成:

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
    validateAndSetPasswordErrors,
    validateAndSetMatchErrors,
    buildSetStorageFn,
    buildGetStorageFn,
} from '../masterPasswordUiCore.js';

describe('masterPasswordUiCore', () => {
    describe('validateAndSetPasswordErrors', () => {
        test('要件を満たさない場合はエラー要素にメッセージを設定する', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetPasswordErrors('ab', errorEl);
            expect(result).toBe(true); // hasError
            expect(errorEl.textContent).toBeTruthy();
            expect(errorEl.classList.add).toHaveBeenCalledWith('visible');
        });

        test('要件を満たす場合はエラーを設定しない', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetPasswordErrors('securePassword123', errorEl);
            expect(result).toBe(false); // no error
            expect(errorEl.classList.add).not.toHaveBeenCalled();
        });
    });

    describe('validateAndSetMatchErrors', () => {
        test('パスワード不一致の場合はエラーを設定する', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetMatchErrors('password1', 'password2', errorEl);
            expect(result).toBe(true);
            expect(errorEl.classList.add).toHaveBeenCalledWith('visible');
        });

        test('パスワード一致の場合はエラーを設定しない', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetMatchErrors('password1', 'password1', errorEl);
            expect(result).toBe(false);
        });
    });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/__tests__/masterPasswordUiCore.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 実装を書く**

`src/utils/masterPasswordUiCore.ts` を作成:

```typescript
/**
 * masterPasswordUiCore.ts
 * マスターパスワードUIの共有ビジネスロジック
 * popup/dashboard間で重複していたロジックをここに集約する
 */

import { validatePasswordRequirements, validatePasswordMatch } from './masterPassword.js';
import { getMessage } from './i18n.js';

/**
 * パスワード要件バリデーションを実行し、エラー要素にメッセージを設定する
 * @returns エラーがある場合 true
 */
export function validateAndSetPasswordErrors(
    password: string,
    errorEl: HTMLElement | null
): boolean {
    const requirementError = validatePasswordRequirements(password);
    if (requirementError && errorEl) {
        errorEl.textContent = getMessage('passwordTooShort') || requirementError;
        errorEl.classList.add('visible');
        return true;
    }
    return false;
}

/**
 * パスワード一致バリデーションを実行し、エラー要素にメッセージを設定する
 * @returns エラーがある場合 true
 */
export function validateAndSetMatchErrors(
    password: string,
    confirmPassword: string,
    errorEl: HTMLElement | null
): boolean {
    const matchError = validatePasswordMatch(password, confirmPassword);
    if (matchError && errorEl) {
        errorEl.textContent = getMessage('passwordMismatch') || matchError;
        errorEl.classList.add('visible');
        return true;
    }
    return false;
}

/**
 * chrome.storage.local.set をラップする関数を生成
 */
export function buildSetStorageFn() {
    return async (key: string, value: unknown) => {
        await chrome.storage.local.set({ [key]: value });
    };
}

/**
 * chrome.storage.local.get をラップする関数を生成
 */
export function buildGetStorageFn() {
    return async (keys: string[]) => {
        return chrome.storage.local.get(keys);
    };
}

/**
 * パスワード強度インジケータを更新する
 */
export function updatePasswordStrengthDisplay(
    password: string,
    strengthBar: HTMLElement | null,
    strengthText: HTMLElement | null,
    calculatePasswordStrength: (pwd: string) => { score: number; level: string; text: string }
): void {
    if (!strengthBar || !strengthText) return;

    if (!password) {
        strengthBar.style.width = '0%';
        strengthBar.className = 'strength-fill';
        strengthText.textContent = getMessage('passwordStrengthWeak') || 'Weak';
        return;
    }

    const result = calculatePasswordStrength(password);
    strengthBar.style.width = `${result.score}%`;
    strengthBar.className = `strength-fill ${result.level}`;
    strengthText.textContent = getMessage(`passwordStrength${result.level.charAt(0).toUpperCase() + result.level.slice(1)}`) || result.text;
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/utils/__tests__/masterPasswordUiCore.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/utils/masterPasswordUiCore.ts src/utils/__tests__/masterPasswordUiCore.test.ts
git commit -m "refactor(ui): add masterPasswordUiCore.ts with shared password logic"
```

---

### Task 2: popup/masterPasswordUi.ts を共有コアに書き換え

**Files:**
- Modify: `src/popup/masterPasswordUi.ts`

- [ ] **Step 1: 共有関数をインポートし、重複関数を置換**

`masterPasswordUi.ts` のインポートに追加:

```typescript
import {
    validateAndSetPasswordErrors,
    validateAndSetMatchErrors,
    buildSetStorageFn,
    updatePasswordStrengthDisplay
} from '../utils/masterPasswordUiCore.js';
```

`updatePasswordStrength()` を以下に置換:

```typescript
function updatePasswordStrength(password: string): void {
    updatePasswordStrengthDisplay(password, passwordStrengthBar, passwordStrengthText, calculatePasswordStrength);
}
```

`savePassword()` 内のバリデーション部分を以下に置換:

```typescript
async function savePassword(): Promise<void> {
    if (!masterPasswordInput) return;

    const password = masterPasswordInput.value;
    const confirmPasswordValue = masterPasswordConfirm?.value ?? '';

    if (validateAndSetPasswordErrors(password, passwordStrengthError)) return;

    if (passwordModalMode === 'set') {
        if (validateAndSetMatchErrors(password, confirmPasswordValue, passwordMatchError)) return;
    }

    const result = await setMasterPassword(password, buildSetStorageFn());

    if (result.success) {
        showStatus('status', getMessage('passwordSaved') || 'Master password saved successfully.', 'success');
        closePasswordModal();
        if (masterPasswordEnabled) masterPasswordEnabled.checked = true;
        if (masterPasswordOptions) masterPasswordOptions.classList.remove('hidden');
    } else {
        showStatus('status', result.error || 'Failed to save password.', 'error');
    }
}
```

`authenticatePassword()` 内のストレージ関数を `buildGetStorageFn()` に置換:

```typescript
async function authenticatePassword(): Promise<void> {
    if (!masterPasswordAuthInput) return;

    const password = masterPasswordAuthInput.value;

    if (!password) {
        if (passwordAuthError) {
            passwordAuthError.textContent = getMessage('passwordRequired') || 'Please enter your master password.';
            passwordAuthError.classList.add('visible');
        }
        return;
    }

    const rateLimitResult = await checkRateLimit();
    if (!rateLimitResult.success) {
        if (passwordAuthError) {
            passwordAuthError.textContent = rateLimitResult.error || 'Too many attempts.';
            passwordAuthError.classList.add('visible');
        }
        return;
    }

    const result = await verifyMasterPassword(password, buildGetStorageFn());

    if (result.success) {
        await resetFailedAttempts();
        const action = pendingPasswordAction;
        closePasswordAuthModal();
        if (action) {
            await action(password);
        }
    } else {
        await recordFailedAttempt();
        if (passwordAuthError) {
            passwordAuthError.textContent = getMessage('passwordIncorrect') || result.error || 'Incorrect password.';
            passwordAuthError.classList.add('visible');
        }
    }
}
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 既存テストがパスすることを確認**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/popup/masterPasswordUi.ts
git commit -m "refactor(ui): use masterPasswordUiCore in popup masterPasswordUi"
```

---

### Task 3: dashboard/masterPassword.ts を共有コアに書き換え

**Files:**
- Modify: `src/dashboard/masterPassword.ts`

- [ ] **Step 1: 共有関数をインポートし、重複関数を置換**

`masterPassword.ts` のインポートに追加:

```typescript
import {
    validateAndSetPasswordErrors,
    validateAndSetMatchErrors,
    buildSetStorageFn,
    buildGetStorageFn,
    updatePasswordStrengthDisplay
} from '../utils/masterPasswordUiCore.js';
```

`updatePasswordStrength()` を以下に置換:

```typescript
function updatePasswordStrength(password: string): void {
    updatePasswordStrengthDisplay(password, passwordStrengthBar, passwordStrengthText, calculatePasswordStrength);
}
```

`savePassword()` 内のバリデーション部分を以下に置換:

```typescript
async function savePassword(): Promise<void> {
    if (!masterPasswordInput) return;
    const password = masterPasswordInput.value;
    const confirmPasswordValue = masterPasswordConfirm?.value ?? '';

    if (validateAndSetPasswordErrors(password, passwordStrengthError)) return;

    if (passwordModalMode === 'set') {
        if (validateAndSetMatchErrors(password, confirmPasswordValue, passwordMatchError)) return;
    }

    const result = await setMasterPassword(password, buildSetStorageFn());

    if (result.success) {
        showStatus('status', getMessage('passwordSaved') || 'Master password saved successfully.', 'success');
        closePasswordModal();
        if (masterPasswordEnabled) masterPasswordEnabled.checked = true;
        if (masterPasswordOptions) masterPasswordOptions.classList.remove('hidden');
        updateMasterPasswordWarningVisibility(true);
    } else {
        showStatus('status', result.error || 'Failed to save password.', 'error');
    }
}
```

`authenticatePassword()` 内のストレージ関数を `buildGetStorageFn()` に置換:

```typescript
async function authenticatePassword(): Promise<void> {
    if (!masterPasswordAuthInput) return;
    const password = masterPasswordAuthInput.value;
    if (!password) {
        if (passwordAuthError) {
            passwordAuthError.textContent = getMessage('passwordRequired') || 'Please enter your master password.';
            passwordAuthError.classList.add('visible');
        }
        return;
    }

    const rateLimitResult = await checkRateLimit();
    if (!rateLimitResult.success) {
        if (passwordAuthError) {
            passwordAuthError.textContent = rateLimitResult.error || 'Too many attempts.';
            passwordAuthError.classList.add('visible');
        }
        return;
    }

    const result = await verifyMasterPassword(password, buildGetStorageFn());
    if (result.success) {
        await resetFailedAttempts();
        const action = pendingPasswordAction;
        closePasswordAuthModal();
        if (action) await action(password);
    } else {
        await recordFailedAttempt();
        if (passwordAuthError) {
            passwordAuthError.textContent = getMessage('passwordIncorrect') || result.error || 'Incorrect password.';
            passwordAuthError.classList.add('visible');
        }
    }
}
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 既存テストがパスすることを確認**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/dashboard/masterPassword.ts
git commit -m "refactor(ui): use masterPasswordUiCore in dashboard masterPassword"
```

---

### Task 4: 全テスト実行 + 手動検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: 全テストを実行**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: 手動テスト（popup）**

1. `npm run build` を実行
2. Chrome で拡張機能を読み込む
3. popup を開き、マスターパスワードを設定 → 変更 → 無効化フローを確認
4. 認証モーダルの動作を確認

- [ ] **Step 4: 手動テスト（dashboard）**

1. dashboard を開く
2. マスターパスワードを設定 → 変更フローを確認
3. 認証モーダルの動作を確認

- [ ] **Step 5: コミット（必要に応じて）**

---

## 検証チェックリスト

- [ ] `masterPasswordUiCore.ts` に `validateAndSetPasswordErrors`, `validateAndSetMatchErrors`, `buildSetStorageFn`, `buildGetStorageFn`, `updatePasswordStrengthDisplay` が存在する
- [ ] popup の `savePassword()` と `authenticatePassword()` が共有関数を使用している
- [ ] dashboard の `savePassword()` と `authenticatePassword()` が共有関数を使用している
- [ ] popup の `<dialog>` API 使用は維持されている
- [ ] dashboard の `focusTrapManager` 使用は維持されている
- [ ] popup の `confirm()` + APIキーワイプ機能は維持されている
- [ ] 既存テストが全てパスする
