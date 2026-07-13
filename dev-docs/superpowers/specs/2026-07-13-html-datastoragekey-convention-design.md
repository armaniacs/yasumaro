# C2: HTML `data-storage-key` Convention — Design Spec

**Date:** 2026-07-13
**Scope:** Replace manual `getSettingsMapping()` / `getDashboardElements()` with attribute-based convention. Eliminate the popup→dashboard import dependency for settings form handling.

## Motivation

The dashboard imports 14 modules from `src/popup/` because settings utilities (`loadSettingsToInputs`, `extractSettingsFromInputs`) use element IDs that happen to match between `options.html` and `popup.html`. Adding a new setting requires updating 3 places (HTML id, `getDashboardElements()`, `getSettingsMapping()`). The 5-Why deep-dig identified the root cause as **HTML template copy-paste** — adapter interfaces would be treating the symptom.

## Decision

Add `data-storage-key` attributes to all settings form inputs. Replace `loadSettingsToInputs` / `extractSettingsFromInputs` with attribute-driven generic implementations that never need updating when settings change.

### HTML Convention

```html
<!-- Before: ID only, requires manual mapping -->
<input id="obsidianPort" type="number" value="27124">

<!-- After: ID + data-storage-key -->
<input id="obsidianPort" type="number" value="27124"
       data-storage-key="obsidianPort">
```

The `data-storage-key` value must match the field name in the `Settings` type (which corresponds to `StorageKeys` constants). Existing `id` attributes are preserved for backward compatibility during migration.

### Generic Utilities

```typescript
// src/utils/settingsFormBinding.ts

/**
 * Populate all form inputs in the container from a settings object.
 * Matches elements by data-storage-key attribute.
 */
function loadSettingsToInputs(container: HTMLElement, settings: Record<string, unknown>): void;

/**
 * Extract all settings from form inputs in the container.
 * Matches elements by data-storage-key attribute.
 */
function extractSettingsFromInputs(container: HTMLElement): Record<string, unknown>;
```

### Element Type Handling

| Element | Read | Write |
|---------|------|-------|
| `input[type="text"]`, `input[type="url"]`, `input[type="number"]` | `el.value` | `el.value = String(v)` |
| `input[type="checkbox"]` | `el.checked` | `el.checked = !!v` |
| `input[type="range"]` | `el.valueAsNumber` | `el.value = String(v)` |
| `select` | `el.value` | `el.value = String(v)` |
| `textarea` | `el.value` | `el.value = String(v)` |

API key fields (detected via `data-storage-key` containing `ApiKey`) are read-only in `extractSettingsFromInputs` when the value matches the masked placeholder — preserving existing security behavior.

### Files Changed

| File | Change |
|------|--------|
| `entrypoints/options/index.html` | Add `data-storage-key` to all settings inputs |
| `src/popup/popup.html` | Add `data-storage-key` to all settings inputs |
| `src/popup/settingsUiHelper.ts` | Replace manual mapping logic with attribute-based generic functions. Export them as `loadSettingsToInputs` / `extractSettingsFromInputs` |
| `src/dashboard/dashboard.ts` | Remove `getSettingsMapping()`, `getDashboardElements()`. `loadGeneralSettings` calls generic functions with `document.body` as container |
| `src/utils/storage/keys.ts` | Add comment mapping `StorageKeys` → expected `data-storage-key` values |

### What Gets Deleted

- `dashboard.ts:getSettingsMapping()` — 30-line manual key-by-key mapping
- `dashboard.ts:getDashboardElements()` — 50-field DOM blob
- `popup/settingsUiHelper.ts:apiKeyFields` — hardcoded API key field list
- 14 popup imports from `dashboard.ts` (most become unnecessary; a few remain for non-settings functions like `initDomainFilter` which is more than a form)

### Migration Strategy

- **No dual-path coexistence**: Functions are replaced in-place. If `data-storage-key` is missing on an element, it is silently skipped (existing behavior: no error, value not loaded/saved).
- **Validation**: A unit test iterates all `StorageKeys` constants and verifies a corresponding `data-storage-key` exists in the HTML. This replaces the implicit contract that `getSettingsMapping()` provided.

### Tests

- **Unit**: `loadSettingsToInputs` with mock DOM — verify text/checkbox/select all populated
- **Unit**: `extractSettingsFromInputs` — verify value types, API key masking
- **Unit**: `StorageKeys` ↔ `data-storage-key` consistency check
- **E2E**: Save settings → reload dashboard → verify values persisted

### Relationship to C1

C2 is independent of C1 but benefits from it: once `StaticFormPanel` descriptors exist, `mount()` can call `loadSettingsToInputs(container, settings)` and `refresh()` can do the same. The `container` parameter naturally scopes the query to the panel's DOM subtree.
