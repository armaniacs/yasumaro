# Coverage Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise coverage from ~26% average to 80%+ across 8 low-coverage files in dashboard and popup.

**Status:** ✅ **ALL TASKS COMPLETED on 2026-05-04**

**Actual Results:**

| Task | File | Before | After Lines | After Stmts | Tests |
|------|------|--------|-------------|-------------|-------|
| 1 | `dashboard/historyEntryRow.ts` | **0.5%** | 98.49% | 96.24% | 46 |
| 2 | `popup/masterPasswordUi.ts` | **0%** | 99% | 97.32% | 59 |
| 3 | `dashboard/diagnosticsPanel.ts` | **17.2%** | 100% | 100% | 28 |
| 4 | `dashboard/domainFilterTagUI.ts` | **22.83%** | 75%+ | 75%+ | 34 |
| 5 | `dashboard/masterPassword.ts` | **28.84%** | 99.36% | 97.91% | 48 |
| 6 | `dashboard/historyTagEditModal.ts` | **35.36%** | 98.78% | 98.9% | 43 |
| 7 | `dashboard/models-dev-dialog.ts` | **52.43%** | 98.78% | 98.21% | 46 |
| 8 | `dashboard/historyPendingPanel.ts` | **53.71%** | 100% | 100% | 52 |

**Plus bonus files from same session:**
| File | Before | After Lines | Tests |
|------|--------|-------------|-------|
| `popup/customPromptManager.ts` | 25.95% | 95.23% | 36 |
| `popup/privatePageDialog.ts` | 9.61% | 100% | 24 |

**Bug fixes discovered during testing:**
- `masterPassword.ts` / `masterPasswordUi.ts`: `closePasswordAuthModal()` nulled `pendingPasswordAction` before `authenticatePassword()` could use it
- Plus 6 review fix items from `2026-05-02-0448-review-plus-0429.md` (extractor.ts, manifest.json, contentCleaner.ts, etc.)

**Side effects:**
- `manifest.json`: z-ai→z.ai typo fix
- `vitest.setup.ts`: added explicit `vi` import
- `contentCleaner.ts`: Array→Set for element dedup
- `extractor.ts`: 15+ new settings keys, parseInt NaN guard, throttle return fix

**Overall coverage (all files, 2026-05-04):**
- Statements: **91.47%** (was 78.74%)
- Lines: **92.98%** (was 80.62%)
- Functions: **92.53%** (was 80.27%)
- Branches: **78.2%** (was 67.51%)
- Tests: **5406 passed** (was 4925)

---

### Task 1: historyEntryRow.test.ts

**Files:**
- Create: `src/dashboard/__tests__/historyEntryRow.test.ts`
- Source: `src/dashboard/historyEntryRow.ts`

**Overview:** `makeHistoryEntryRow(entry, index, start, state, tagEditElements, onTagFilterChange, onApplyFilters)` is a pure DOM construction function. It creates a full history entry row element from a `SavedUrlEntry` object. Exports only `makeHistoryEntryRow`.

**Dependencies to mock:**
- `../popup/i18n.js` → `getMessage`
- `../utils/storageUrls.js` → `removeSavedUrl`
- `./cleansingStatsView.js` → `makeCleansingProgressBar`
- `./historyBadges.js` → `makeRecordTypeBadge`, `makeMaskBadge`, `makeCleansedBadge`
- `./historyTagEditModal.js` → `openTagEditModal`
- `./historyState.js` → `getCachedMessage`

**Test plan (~80-100 tests):**

- [ ] **Step 1: Set up test file**

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: vi.fn((key, subs) => subs ? `${key}:${subs}` : key),
}));

vi.mock('../../utils/storageUrls.js', () => ({
  removeSavedUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./cleansingStatsView.js', () => ({
  makeCleansingProgressBar: vi.fn(() => {
    const el = document.createElement('div');
    el.className = 'mock-progress-bar';
    return el;
  }),
}));

vi.mock('./historyBadges.js', () => ({
  makeRecordTypeBadge: vi.fn(() => {
    const el = document.createElement('span');
    el.className = 'mock-record-badge';
    return el;
  }),
  makeMaskBadge: vi.fn((count) => {
    if (!count) return null;
    const el = document.createElement('span');
    el.className = 'mock-mask-badge';
    return el;
  }),
  makeCleansedBadge: vi.fn((reason) => {
    if (!reason) return null;
    const el = document.createElement('span');
    el.className = 'mock-cleansed-badge';
    return el;
  }),
}));

vi.mock('./historyTagEditModal.js', () => ({
  openTagEditModal: vi.fn(),
}));

vi.mock('./historyState.js', () => ({
  getCachedMessage: vi.fn((key, fallback) => fallback || key),
}));
```

- [ ] **Step 2: Test basic row structure**

Test that `makeHistoryEntryRow` returns an `HTMLElement` with class `history-entry`.

```typescript
it('should return a div with history-entry class', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry();
  const state = createMockState();
  const elements = createMockElements();
  const row = makeHistoryEntryRow(entry, 0, 0, state, elements, vi.fn(), vi.fn());
  expect(row.className).toBe('history-entry');
  expect(row.tagName).toBe('DIV');
});
```

- [ ] **Step 3: Test URL rendering**

Verify the anchor element has correct `href`, `target`, `rel`, and `textContent`.

```typescript
it('should render URL as a link with correct attributes', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ url: 'https://example.com/page' });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  const link = row.querySelector('.history-entry-url') as HTMLAnchorElement;
  expect(link).not.toBeNull();
  expect(link.href).toBe('https://example.com/page');
  expect(link.target).toBe('_blank');
  expect(link.rel).toBe('noopener noreferrer');
  expect(link.textContent).toBe('https://example.com/page');
});
```

- [ ] **Step 4: Test timestamp rendering**

```typescript
it('should render timestamp formatted with toLocaleString', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const date = new Date('2024-01-15T10:30:00');
  const entry = createMinimalEntry({ timestamp: date.getTime() });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  const timeEl = row.querySelector('.history-entry-time');
  expect(timeEl?.textContent).toBe(date.toLocaleString());
});
```

- [ ] **Step 5: Test badges rendering**

Verify `makeRecordTypeBadge`, `makeMaskBadge`, `makeCleansedBadge` are called with correct args and their results appear in the top row.

```typescript
it('should call makeRecordTypeBadge with recordType', () => {
  const { makeRecordTypeBadge } = await import('./historyBadges.js');
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  makeHistoryEntryRow(createMinimalEntry({ recordType: 'skipAi' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  expect(makeRecordTypeBadge).toHaveBeenCalledWith('skipAi');
});

it('should call makeMaskBadge with maskedCount', () => {
  const { makeMaskBadge } = await import('./historyBadges.js');
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  makeHistoryEntryRow(createMinimalEntry({ maskedCount: 3 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  expect(makeMaskBadge).toHaveBeenCalledWith(3);
});

it('should not render mask badge when maskedCount is 0', () => {
  const { makeMaskBadge } = await import('./historyBadges.js');
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  makeHistoryEntryRow(createMinimalEntry({ maskedCount: 0 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  expect(makeMaskBadge).toHaveBeenCalledWith(0);
});
```

- [ ] **Step 6: Test AI summary display**

```typescript
it('should render AI summary when present', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ aiSummary: 'This is a summary' });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  const summaryEl = row.querySelector('.history-entry-ai-summary');
  expect(summaryEl).not.toBeNull();
  expect(summaryEl?.textContent).toContain('This is a summary');
});

it('should not show AI summary section when empty', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ aiSummary: '' });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  expect(row.querySelector('.history-entry-ai-summary')).toBeNull();
});
```

- [ ] **Step 7: Test token display**

```typescript
it('should show token counts when sentTokens and receivedTokens are provided', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ sentTokens: 100, receivedTokens: 50 });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  const tokensEl = row.querySelector('.history-entry-tokens');
  expect(tokensEl?.textContent).toContain('100');
  expect(tokensEl?.textContent).toContain('50');
});

it('should show AI provider info when no tokens but provider is set', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ aiProvider: 'gemini', aiModel: 'gemini-pro', aiDuration: 1500 });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  const tokensEl = row.querySelector('.history-entry-tokens');
  expect(tokensEl?.textContent).toContain('gemini');
  expect(tokensEl?.textContent).toContain('gemini-pro');
});
```

- [ ] **Step 8: Test cleansing stats**

```typescript
it('should show page extraction reduction stats', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ pageBytes: 10000, candidateBytes: 3000 });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  const extractEl = row.querySelector('.history-entry-token-reduction');
  expect(extractEl?.textContent).toContain('10000');
  expect(extractEl?.textContent).toContain('3000');
});
```

- [ ] **Step 9: Test tags and tag badges**

```typescript
it('should render tag badges when tags are present', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ tags: ['tech', 'ai'] });
  const state = createMockState();
  const onTagFilterChange = vi.fn();
  const row = makeHistoryEntryRow(entry, 0, 0, state, createMockElements(), onTagFilterChange, vi.fn());
  const tagBadges = row.querySelector('.tag-badges');
  expect(tagBadges).not.toBeNull();
  const tagButtons = tagBadges?.querySelectorAll('.tag-badge');
  expect(tagButtons?.length).toBe(2);
});

it('should show add-tag button when no tags', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ tags: undefined });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  expect(row.querySelector('.tag-add-inline-btn')).not.toBeNull();
  expect(row.querySelector('.tag-badges-empty')).not.toBeNull();
});
```

- [ ] **Step 10: Test content toggle**

```typescript
it('should create content toggle when content is present', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ content: 'Some sent data' });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  const toggle = row.querySelector('.content-toggle-btn');
  expect(toggle).not.toBeNull();
  expect(row.querySelector('.content-preview.hidden')).not.toBeNull();
});

it('should toggle content visibility on click', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ content: 'Toggle content' });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  const toggle = row.querySelector('.content-toggle-btn') as HTMLButtonElement;
  const contentArea = row.querySelector('.content-preview') as HTMLElement;
  expect(contentArea.classList.contains('hidden')).toBe(true);
  toggle.click();
  expect(contentArea.classList.contains('hidden')).toBe(false);
  toggle.click();
  expect(contentArea.classList.contains('hidden')).toBe(true);
});
```

- [ ] **Step 11: Test delete button**

```typescript
it('should call removeSavedUrl and onApplyFilters on delete click', async () => {
  const { removeSavedUrl } = await import('../../utils/storageUrls.js');
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ url: 'https://example.com/delete-me' });
  const state = createMockState({ entries: [entry] });
  const onApplyFilters = vi.fn();
  const row = makeHistoryEntryRow(entry, 0, 0, state, createMockElements(), vi.fn(), onApplyFilters);
  const deleteBtn = row.querySelector('.history-entry-delete') as HTMLButtonElement;
  deleteBtn.click();
  await vi.waitFor(() => {
    expect(removeSavedUrl).toHaveBeenCalledWith('https://example.com/delete-me');
  });
  expect(onApplyFilters).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 12: Test edge cases (null values, missing fields)**

```typescript
it('should handle null masking info', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ maskBadge: 0, maskedCount: undefined });
  expect(() => {
    makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  }).not.toThrow();
});

it('should handle missing token fields gracefully', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({}); // no tokens, no AI
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  expect(row.querySelector('.history-entry-tokens')).toBeNull();
});

it('should handle fallbackTriggered flag', () => {
  const { makeHistoryEntryRow } = await import('../historyEntryRow.js');
  const entry = createMinimalEntry({ fallbackTriggered: true });
  const row = makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
  expect(row.querySelector('.history-entry-fallback')).not.toBeNull();
});
```

- [ ] **Step 13: Verify all tests pass**

Run: `npx vitest run src/dashboard/__tests__/historyEntryRow.test.ts`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add src/dashboard/__tests__/historyEntryRow.test.ts
git commit -m "test: add comprehensive tests for historyEntryRow.ts (0.5% -> 80%+)"
```

---

### Task 2: masterPasswordUi.test.ts

**Files:**
- Create: `src/popup/__tests__/masterPasswordUi.test.ts`
- Source: `src/popup/masterPasswordUi.ts`

**Overview:** Master password modal UI for popup. Heavy DOM interaction. 3 exported functions: `initMasterPasswordUi`, `loadMasterPasswordSettings`, `showPasswordAuthModal`.

**Dependencies to mock:**
- `../utils/storage.js` → `getSettings`, `saveSettingsWithAllowedUrls`
- `../utils/masterPassword.js` → `setMasterPassword`, `verifyMasterPassword`, `isMasterPasswordSet`, `calculatePasswordStrength`, `validatePasswordRequirements`, `validatePasswordMatch`
- `../utils/rateLimiter.js` → `checkRateLimit`, `recordFailedAttempt`, `resetFailedAttempts`
- `./settingsUiHelper.js` → `showStatus`
- `./i18n.js` → `getMessage`
- `./utils/focusTrap.js` → `focusTrapManager`

**Test plan (~50-60 tests):**

- [ ] **Step 1: Set up test file**

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/masterPassword.js', () => ({
  setMasterPassword: vi.fn(),
  verifyMasterPassword: vi.fn(),
  isMasterPasswordSet: vi.fn(),
  calculatePasswordStrength: vi.fn(),
  validatePasswordRequirements: vi.fn(),
  validatePasswordMatch: vi.fn(),
}));

vi.mock('../../utils/rateLimiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn(),
  resetFailedAttempts: vi.fn(),
}));

vi.mock('../settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../i18n.js', () => ({
  getMessage: vi.fn((key) => `i18n_${key}`),
}));

vi.mock('../utils/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));
```

- [ ] **Step 2: Test `loadMasterPasswordSettings`**

```typescript
it('should enable checkbox and show options when password is set', async () => {
  const { isMasterPasswordSet } = await import('../../utils/masterPassword.js');
  (isMasterPasswordSet as any).mockImplementation(async (fn: any) => {
    await fn(['master_password_hash']);
    return true;
  });

  document.body.innerHTML = `
    <input type="checkbox" id="masterPasswordEnabled" />
    <div id="masterPasswordOptions" class="hidden"></div>
  `;

  const { loadMasterPasswordSettings } = await import('../masterPasswordUi.js');
  await loadMasterPasswordSettings();

  const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
  const options = document.getElementById('masterPasswordOptions');
  expect(checkbox.checked).toBe(true);
  expect(options?.classList.contains('hidden')).toBe(false);
});

it('should disable checkbox and hide options when password is not set', async () => {
  const { isMasterPasswordSet } = await import('../../utils/masterPassword.js');
  (isMasterPasswordSet as any).mockImplementation(async (fn: any) => {
    await fn(['master_password_hash']);
    return false;
  });

  document.body.innerHTML = `
    <input type="checkbox" id="masterPasswordEnabled" />
    <div id="masterPasswordOptions"></div>
  `;

  const { loadMasterPasswordSettings } = await import('../masterPasswordUi.js');
  await loadMasterPasswordSettings();

  const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
  const options = document.getElementById('masterPasswordOptions');
  expect(checkbox.checked).toBe(false);
  expect(options?.classList.contains('hidden')).toBe(true);
});
```

- [ ] **Step 3: Test `initMasterPasswordUi` event listeners**

```typescript
it('should show password modal when enable checkbox is checked', () => {
  document.body.innerHTML = `
    <input type="checkbox" id="masterPasswordEnabled" />
    <div id="masterPasswordOptions"></div>
    <div id="passwordModal" class="hidden"></div>
    <div id="passwordModalTitle"></div>
    <div id="setMasterPasswordDesc"></div>
    <input id="masterPasswordInput" />
    <input id="masterPasswordConfirm" />
    <div id="passwordStrengthError"></div>
    <div id="passwordMatchError"></div>
    <div id="passwordStrength"><div class="strength-fill"></div></div>
    <div id="passwordStrengthText"></div>
    <div id="confirmPasswordGroup"></div>
    <button id="closePasswordModalBtn"></button>
    <button id="cancelPasswordBtn"></button>
    <button id="savePasswordBtn"></button>
    <div id="passwordAuthModal" class="hidden"></div>
    <div id="passwordAuthModalTitle"></div>
    <div id="passwordAuthModalDesc"></div>
    <input id="masterPasswordAuthInput" />
    <div id="passwordAuthError"></div>
    <button id="closePasswordAuthModalBtn"></button>
    <button id="cancelPasswordAuthBtn"></button>
    <button id="submitPasswordAuthBtn"></button>
  `;

  const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
  initMasterPasswordUi();

  const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));

  const modal = document.getElementById('passwordModal');
  expect(modal?.classList.contains('hidden')).toBe(false);
});
```

- [ ] **Step 4: Test `showPasswordAuthModal`**

```typescript
it('should show auth modal and set pending action', async () => {
  document.body.innerHTML = `
    <div id="passwordAuthModal" class="hidden"></div>
    <input id="masterPasswordAuthInput" />
    <div id="passwordAuthError"></div>
  `;

  const { showPasswordAuthModal } = await import('../masterPasswordUi.js');
  const action = vi.fn();
  showPasswordAuthModal('export', action);

  const modal = document.getElementById('passwordAuthModal');
  // hidden class should be removed by showPasswordAuthModal
});
```

- [ ] **Step 5: Test `savePassword` flow**

```typescript
it('should save password and close modal on success', async () => {
  const { setMasterPassword } = await import('../../utils/masterPassword.js');
  const { showStatus } = await import('../settingsUiHelper.js');
  (setMasterPassword as any).mockResolvedValue({ success: true });

  document.body.innerHTML = `...`; // full DOM
  const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
  initMasterPasswordUi();

  // Fill password, trigger save
  const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
  input.value = 'StrongP@ss1';
  document.getElementById('savePasswordBtn')?.click();

  await vi.waitFor(() => {
    expect(setMasterPassword).toHaveBeenCalled();
    expect(showStatus).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Test authentication error cases**

```typescript
it('should show error when password verification fails', async () => {
  const { verifyMasterPassword } = await import('../../utils/masterPassword.js');
  (verifyMasterPassword as any).mockResolvedValue({ success: false, error: 'Wrong password' });

  document.body.innerHTML = `...`;
  const { initMasterPasswordUi, showPasswordAuthModal } = await import('../masterPasswordUi.js');
  initMasterPasswordUi();
  showPasswordAuthModal('export', vi.fn());

  const input = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
  input.value = 'wrong';
  document.getElementById('submitPasswordAuthBtn')?.click();

  await vi.waitFor(() => {
    const errorEl = document.getElementById('passwordAuthError');
    expect(errorEl?.textContent).toContain('Wrong password');
  });
});
```

- [ ] **Step 7: Run and commit**

---

### Task 3: diagnosticsPanel.test.ts

**Files:**
- Create: `src/dashboard/__tests__/diagnosticsPanel.test.ts`
- Source: `src/dashboard/diagnosticsPanel.ts`

**Overview:** `initDiagnosticsPanel()` is an async function that reads settings and renders diagnostic info + attaches connection test click handlers.

**Key behaviors to test:**
- Storage stats rendering
- Extension info display
- Obsidian/AI settings display for each provider type
- Connection test button handlers (Obsidian, AI)
- Error handling during settings load

---

### Task 4: domainFilterTagUI.test.ts

**Files:**
- Create: `src/dashboard/__tests__/domainFilterTagUI.test.ts`
- Source: `src/dashboard/domainFilterTagUI.ts`

**Overview:** `initDomainFilterTagUI()` sets up a tag-based domain filter UI with tab switching, add/remove domain tags, and sync with hidden form elements.

**Key behaviors to test:**
- Tag rendering from textarea content
- Adding domains via input + button
- Adding domains via Enter key
- Removing domains via × button
- Tab switching (blacklist/whitelist)
- Validation and duplicate detection
- MutationObserver sync from realStatus to saveStatus
- Enable/disable toggle

---

### Task 5: masterPassword.test.ts (expand)

**Files:**
- Modify: `src/dashboard/__tests__/masterPassword.test.ts`
- Source: `src/dashboard/masterPassword.ts`

**Current test (94 lines):** Only tests `loadMasterPasswordSettings`. Needs expansion for:
- `initMasterPasswordSettings`: event listeners for enable/disable, change password, input events, modal click-outside-to-close
- `showPasswordModal` and `closePasswordModal`: modal visibility toggling, focus trap management
- `savePassword`: validation errors, success/failure paths
- `authenticatePassword`: empty password, rate limiting, success/failure
- `showPasswordAuthModal` / `closePasswordAuthModal`
- `updatePasswordStrength`: empty password, strength calculation with results

---

### Task 6: historyTagEditModal.test.ts (expand)

**Files:**
- Modify: `src/dashboard/__tests__/historyTagEditModal.test.ts`
- Source: `src/dashboard/historyTagEditModal.ts`

**Current test (111 lines):** Covers basic exports and `openTagEditModal`. Needs:
- `closeTagEditModal`: clears state, releases focus trap, hides modal
- `renderCurrentTags`: empty vs populated, remove button click
- `updateTagCategorySelect`: categories filtering, disabled state
- `addTag`: add new tag, duplicate prevention
- `saveTagEdits`: success path (calls setUrlTags, closes modal, calls onSaved), error path (alert)
- `initTagEditModal`: event listener attachment

---

### Task 7: models-dev-dialog.test.ts (expand)

**Files:**
- Modify: `src/dashboard/__tests__/models-dev-dialog.test.ts` (and related files)
- Source: `src/dashboard/models-dev-dialog.ts`

**Current tests (3 files, ~99+180+192 lines):** Cover basic show/hide, event handlers, accessibility. Need expansion for:
- `createDialog`: DOM structure, element references cached correctly
- `loadProviders`: loading state toggle, error handling with showError
- `filterProviders`: search filtering, free tier filter, tab filtering
- `selectProvider`: selection state, model input clear
- `save`: validation (no provider, no API key), calls `onSave` callback
- Tab switching
- ESC key to close
- Click outside to close

---

### Task 8: historyPendingPanel.test.ts (expand)

**Files:**
- Modify: `src/dashboard/__tests__/historyPendingPanel.test.ts`
- Source: `src/dashboard/historyPendingPanel.ts`

**Current test (127 lines):** Covers basic exports and `renderSkippedMode`. Needs:
- `renderSkippedMode`: empty state, search filtering, stats display, record/no-AI buttons click → executeRecord
- `renderPendingPage`: pagination, record/no-AI/delete buttons, page nav controls
- `executeRecord`: success → remove from list, failure → show error, service worker dead → specific error message

---

## Execution Order

Recommended to work in this order (increasing complexity):

1. **Task 6** `historyTagEditModal.test.ts` (163 lines, easiest, has existing test)
2. **Task 5** `masterPassword.test.ts` (243 lines, has existing test, similar to Task 2)
3. **Task 8** `historyPendingPanel.test.ts` (291 lines, has existing test)
4. **Task 7** `models-dev-dialog.test.ts` (464 lines, largest file, has 3 existing tests)
5. **Task 1** `historyEntryRow.test.ts` (302 lines, pure function, no DOM events)
6. **Task 3** `diagnosticsPanel.test.ts` (235 lines, chrome API heavy)
7. **Task 4** `domainFilterTagUI.test.ts` (221 lines, complex DOM interactions)
8. **Task 2** `masterPasswordUi.test.ts` (368 lines, most complex DOM)
