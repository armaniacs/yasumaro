# PBI-23: プライバシー同意バージョン移行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プライバシー同意データにバージョン管理を導入し、ポリシー更新時に再同意を促すフローを実装する

**Architecture:** 既存の `privacyConsent.ts` の `getPrivacyConsent()` にバージョンチェックロジックを追加し、`PRIVACY_CONSENT_VERSION` 定数との不一致を検出した際に再同意モーダルを表示する。旧形式（boolean）の自動変換は既存の `migrateLegacyPrivacyConsent()` に統合する。

**Tech Stack:** TypeScript, Chrome Storage API, Vitest

---

## ファイル構成

| ファイル | 役割 | 変更種別 |
|---------|------|---------|
| `src/utils/storage/types.ts` | `PRIVACY_CONSENT_VERSION` 定数追加 | 変更 |
| `src/popup/privacyConsent.ts` | バージョンチェック＋再同意判定ロジック | 変更 |
| `src/popup/privacyConsentController.ts` | 再同意モーダル表示制御 | 変更 |
| `src/popup/__tests__/privacyConsent.test.ts` | バージョン移行テスト追加 | 変更 |

---

## 現状の問題点

1. `PRIVACY_CONSENT_VERSION = '2026-02-23'` はハードコードされた文字列で、`types.ts` に定義されていない
2. バージョン不一致時に `getPrivacyConsent()` は `hasConsented: false` を返すが、**拒否カウンターがリセットされない**
3. 旧形式（boolean）→新形式（オブジェクト）の変換は `migrateLegacyPrivacyConsent()` で実装済みだが、バージョン情報が含まれない
4. 再同意モーダルの表示トリガーが明示的でない

---

### Task 1: StorageKeys に PRIVACY_CONSENT_VERSION を追加

**Files:**
- Modify: `src/utils/storage/types.ts:88-91`

- [ ] **Step 1: types.ts に定数を追加**

```typescript
// src/utils/storage/types.ts の StorageKeys 列挙型内に追加
PRIVACY_CONSENT_VERSION = 'privacy_consent_version',
```

- [ ] **Step 2: defaults.ts にデフォルト値を追加**

```typescript
// src/utils/storage/defaults.ts に追加
[StorageKeys.PRIVACY_CONSENT_VERSION]: 1,
```

- [ ] **Step 3: types.ts の Settings 型に追加**

```typescript
// src/utils/storage/types.ts の Settings インターフェース内に追加
[StorageKeys.PRIVACY_CONSENT_VERSION]: number;
```

- [ ] **Step 4: コンパイル確認**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/storage/types.ts src/utils/storage/defaults.ts
git commit -m "feat(storage): add PRIVACY_CONSENT_VERSION key"
```

---

### Task 2: privacyConsent.ts にバージョンチェックロジックを追加

**Files:**
- Modify: `src/popup/privacyConsent.ts:11` (定数定義)
- Modify: `src/popup/privacyConsent.ts:26-63` (getPrivacyConsent)

- [ ] **Step 1: テストを書く — バージョン不一致で再同意が必要**

```typescript
// src/popup/__tests__/privacyConsent.test.ts に追加
describe('getPrivacyConsent - version check', () => {
  it('should return hasConsented: false when consent version is outdated', async () => {
    const currentVersion = PRIVACY_CONSENT_VERSION + '-old';
    chrome.storage.local.get.mockResolvedValue({
      [StorageKeys.PRIVACY_CONSENT]: {
        hasConsented: true,
        consentDate: '2026-01-01T00:00:00.000Z',
        consentVersion: currentVersion,
      },
    });
    chrome.storage.local.get.mockResolvedValue({
      [StorageKeys.PRIVACY_CONSENT_VERSION]: 1,
    });

    const result = await getPrivacyConsent();
    expect(result.hasConsented).toBe(false);
    expect(result.needsReconsent).toBe(true);
  });

  it('should return hasConsented: true when version matches', async () => {
    chrome.storage.local.get.mockResolvedValue({
      [StorageKeys.PRIVACY_CONSENT]: {
        hasConsented: true,
        consentDate: '2026-01-01T00:00:00.000Z',
        consentVersion: PRIVACY_CONSENT_VERSION,
      },
    });

    const result = await getPrivacyConsent();
    expect(result.hasConsented).toBe(true);
    expect(result.needsReconsent).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/popup/__tests__/privacyConsent.test.ts`
Expected: FAIL (needsReconsent プロパティが未定義)

- [ ] **Step 3: getPrivacyConsent にバージョンチェックを追加**

```typescript
// src/popup/privacyConsent.ts の getPrivacyConsent 関数を修正

export interface PrivacyConsentResult {
  hasConsented: boolean;
  consentDate?: string;
  consentVersion?: string;
  needsReconsent?: boolean;  // 新規追加
}

export async function getPrivacyConsent(): Promise<PrivacyConsentResult> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.PRIVACY_CONSENT);
    const data = result[StorageKeys.PRIVACY_CONSENT];

    // 未設定
    if (data === undefined || data === null) {
      return { hasConsented: false };
    }

    // 旧形式（boolean）の処理
    if (typeof data === 'boolean') {
      return { hasConsented: data };
    }

    // オブジェクト形式の処理
    if (typeof data === 'object' && 'hasConsented' in data) {
      const hasConsented = data.hasConsented === true;
      const consentVersion = data.consentVersion;

      // バージョンチェック: 同意済みだがバージョンが古い場合
      if (hasConsented && consentVersion !== PRIVACY_CONSENT_VERSION) {
        return {
          hasConsented: false,
          consentDate: data.consentDate,
          consentVersion,
          needsReconsent: true,  // 再同意が必要
        };
      }

      return {
        hasConsented,
        consentDate: data.consentDate,
        consentVersion,
        needsReconsent: false,
      };
    }

    return { hasConsented: false };
  } catch (error) {
    console.error('Failed to get privacy consent:', error);
    return { hasConsented: false };
  }
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/popup/__tests__/privacyConsent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/popup/privacyConsent.ts src/popup/__tests__/privacyConsent.test.ts
git commit -m "feat(privacy): add version check to getPrivacyConsent"
```

---

### Task 3: マイグレーション時にバージョンを付与する

**Files:**
- Modify: `src/popup/privacyConsent.ts:117-164` (migrateLegacyPrivacyConsent)

- [ ] **Step 1: テストを書く — マイグレーション時に正しいバージョンが付与される**

```typescript
// src/popup/__tests__/privacyConsent.test.ts に追加
describe('migrateLegacyPrivacyConsent - version assignment', () => {
  it('should assign current version when migrating legacy boolean consent', async () => {
    chrome.storage.local.get.mockResolvedValue({
      [StorageKeys.PRIVACY_CONSENT]: true,
    });
    chrome.storage.local.set.mockResolvedValue(undefined);

    await migrateLegacyPrivacyConsent();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        [StorageKeys.PRIVACY_CONSENT]: expect.objectContaining({
          hasConsented: true,
          consentVersion: PRIVACY_CONSENT_VERSION,
        }),
      })
    );
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/popup/__tests__/privacyConsent.test.ts`
Expected: FAIL (consentVersion が未設定)

- [ ] **Step 3: migrateLegacyPrivacyConsent にバージョン付与を追加**

```typescript
// src/popup/privacyConsent.ts の migrateLegacyPrivacyConsent 内の
// savePrivacyConsent() 呼び出しを確認（既にバージョン引数を受け取る）

// 既存の savePrivacyConsent 呼び出し:
await savePrivacyConsent(PRIVACY_CONSENT_VERSION);

// これは既に正しく動作している（デフォルト引数で PRIVACY_CONSENT_VERSION を使用）
// 確認: savePrivacyConsent のシグネチャ
export async function savePrivacyConsent(
  version: string = PRIVACY_CONSENT_VERSION
): Promise<void> {
  const consent = {
    hasConsented: true,
    consentDate: new Date().toISOString(),
    consentVersion: version,
  };
  await chrome.storage.local.set({ [StorageKeys.PRIVACY_CONSENT]: consent });
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/popup/__tests__/privacyConsent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/popup/privacyConsent.ts src/popup/__tests__/privacyConsent.test.ts
git commit -m "feat(privacy): ensure migration assigns current version"
```

---

### Task 4: privacyConsentController に再同意モーダル表示ロジックを追加

**Files:**
- Modify: `src/popup/privacyConsentController.ts:39-60` (initPrivacyConsent)

- [ ] **Step 1: テストを書く — needsReconsent でモーダルが表示される**

```typescript
// src/popup/__tests__/privacyConsentController.test.ts に追加
describe('initPrivacyConsent - re-consent', () => {
  it('should show modal when needsReconsent is true', async () => {
    mockGetPrivacyConsent.mockResolvedValue({
      hasConsented: false,
      needsReconsent: true,
    });
    mockGetConsentDeniedCount.mockResolvedValue(0);

    await initPrivacyConsent();

    expect(mockShowPrivacyConsentModal).toHaveBeenCalled();
  });

  it('should reset denial count when re-consent is triggered by version change', async () => {
    mockGetPrivacyConsent.mockResolvedValue({
      hasConsented: false,
      needsReconsent: true,
    });
    mockGetConsentDeniedCount.mockResolvedValue(3); // 3回拒否済み

    await initPrivacyConsent();

    // バージョン変更による再同意の場合、拒否カウンターをリセットすべき
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: 0,
      })
    );
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/popup/__tests__/privacyConsentController.test.ts`
Expected: FAIL

- [ ] **Step 3: initPrivacyConsent に再同意ロジックを追加**

```typescript
// src/popup/privacyConsentController.ts の initPrivacyConsent 関数を修正

export async function initPrivacyConsent(
  onConsent: (consented: boolean) => void
): Promise<void> {
  try {
    // レガシーマイグレーション
    await migrateLegacyPrivacyConsent();

    // 同意状態を取得
    const consent = await getPrivacyConsent();

    if (consent.hasConsented) {
      // 同意済み — モーダル不要
      return;
    }

    // 再同意が必要な場合（バージョン更新）
    if (consent.needsReconsent) {
      // 拒否カウンターをリセット（バージョン変更による再同意）
      await chrome.storage.local.set({
        [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: 0,
        [StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME]: 0,
      });
      // モーダルを表示
      showPrivacyConsentModal(onConsent);
      return;
    }

    // 通常の未同意状態
    const deniedCount = await getConsentDeniedCount();

    if (deniedCount >= 3) {
      const lastDenialTime = await getLastDenialTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      if (Date.now() - lastDenialTime < thirtyDaysMs) {
        // 30日以内 — モーダル非表示（制限モード）
        return;
      }
      // 30日超過 — 再表示
    }

    showPrivacyConsentModal(onConsent);
  } catch (error) {
    console.error('Privacy consent initialization failed:', error);
  }
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/popup/__tests__/privacyConsentController.test.ts`
Expected: PASS

- [ ] **Step 5: 全テストを実行**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/popup/privacyConsentController.ts src/popup/__tests__/privacyConsentController.test.ts
git commit -m "feat(privacy): add re-consent modal on version change"
```

---

### Task 5: エッジケースと統合テスト

**Files:**
- Modify: `src/popup/__tests__/privacyConsent.test.ts`

- [ ] **Step 1: エッジケーステストを追加**

```typescript
// src/popup/__tests__/privacyConsent.test.ts に追加
describe('getPrivacyConsent - edge cases', () => {
  it('should handle withdrawal object in consent data', async () => {
    chrome.storage.local.get.mockResolvedValue({
      [StorageKeys.PRIVACY_CONSENT]: {
        hasConsented: false,
        consentDate: '2026-01-01T00:00:00.000Z',
        consentVersion: PRIVACY_CONSENT_VERSION,
        withdrawal: {
          withdrawalDate: '2026-06-01T00:00:00.000Z',
          previousConsentDate: '2026-01-01T00:00:00.000Z',
          previousConsentVersion: PRIVACY_CONSENT_VERSION,
        },
      },
    });

    const result = await getPrivacyConsent();
    expect(result.hasConsented).toBe(false);
    expect(result.needsReconsent).toBe(false);
  });

  it('should handle empty string consent version', async () => {
    chrome.storage.local.get.mockResolvedValue({
      [StorageKeys.PRIVACY_CONSENT]: {
        hasConsented: true,
        consentDate: '2026-01-01T00:00:00.000Z',
        consentVersion: '',
      },
    });

    const result = await getPrivacyConsent();
    expect(result.hasConsented).toBe(false);
    expect(result.needsReconsent).toBe(true);
  });

  it('should handle non-object, non-boolean, non-null data', async () => {
    chrome.storage.local.get.mockResolvedValue({
      [StorageKeys.PRIVACY_CONSENT]: 'invalid',
    });

    const result = await getPrivacyConsent();
    expect(result.hasConsented).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行してパスを確認**

Run: `npx vitest run src/popup/__tests__/privacyConsent.test.ts`
Expected: PASS

- [ ] **Step 3: 全テストを実行**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/popup/__tests__/privacyConsent.test.ts
git commit -m "test(privacy): add edge case tests for version migration"
```

---

## Definition of Done

- [ ] `PRIVACY_CONSENT_VERSION` が `StorageKeys` に追加されている
- [ ] 旧形式（boolean）→新形式（オブジェクト）への自動変換が動作する
- [ ] バージョン不一致時に `needsReconsent: true` が返される
- [ ] 再同意モーダルが正しく表示される
- [ ] 再同意時に拒否カウンターがリセットされる
- [ ] 既存の制限モード動作が壊れない
- [ ] 全テストがパスする
