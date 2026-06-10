# Test Coverage Analysis — Priority Files

## Testing Conventions

- **Framework:** Jest with `@jest/globals` imports
- **Environment:** `@jest-environment jsdom` for DOM tests, default for pure logic
- **Chrome API Mocking:** Manual `global.chrome` object with `Map`-backed storage mock
- **Crypto Mocking:** `@peculiar/webcrypto` polyfill
- **Module Mocking:** `jest.mock('../../../path.js')` at file top
- **Naming:** `*.test.ts` in `__tests__/` subdirectories
- **Language:** Test descriptions in Japanese
- **Structure:** `describe` → `beforeEach` → `test`/`it` with `expect()`

## Priority Tier 1 — Highest ROI

| File | Lines | Complexity | Testability | Tests Needed |
|------|-------|-----------|-------------|-------------|
| `checkDomainFilterStep.ts` | 39 | Low | Easy | 3 branches: allowed, blocked+force, blocked+no-force |
| `checkDuplicateStep.ts` | 77 | Medium | Easy | Same-day dup, different-day, URL limit, warning threshold, skipDuplicateCheck |
| `checkPermissionStep.ts` | 48 | Medium | Easy | Granted, denied+recordDeniedVisit, invalid URL |
| `checkTrustDomainStep.ts` | 51 | Medium | Medium | Trusted, untrusted+force, untrusted+no-force, alert display |
| `truncateContentStep.ts` | 68 | Low | Easy | Under limit, over limit, empty, UTF-8 boundaries |
| `formatMarkdownStep.ts` | 40 | Low | Easy | Markdown format, XSS sanitization, timestamp |
| `messaging/types.ts` | 356 | Medium | Easy | Type guards, response guards, message validation |
| `saveMetadataStep.ts` | 150 | High | Medium | All metadata fields, best-effort errors, empty fields |
| `privacy.ts` | 161 | Medium | Easy | escapeHtml, renderMarkdown, renderInline |

## Priority Tier 2 — High Value

| File | Lines | Complexity | Testability | Tests Needed |
|------|-------|-----------|-------------|-------------|
| `storageUrls.ts` | 785 | High | Medium | Timestamps, optimistic lock, LRU cleanup, tags CRUD, buildAllowedUrls |
| `trustDb/trustDb.ts` | 990 | High | Medium | Domain validation, 3-step verification, CRUD operations |
| `domainFilter.ts` | 343 | Medium | Medium | Tab switching, visibility, load/save settings, format toggle |
| `crypto.ts` | 534 | Medium | Easy | HMAC, signature, hashUrl (additional to 63% existing) |
| `sessionAlarmsManager.ts` | 183 | Medium | Medium | Activity update, alarm start/stop, timeout check, lock |

## Priority Tier 3 — Medium Value

| File | Lines | Complexity | Testability | Tests Needed |
|------|-------|-----------|-------------|-------------|
| `trustSettings.ts` | 618 | High | Medium | Render functions, safety mode mapping, permission suggest |
| `ublockImport/index.ts` | 435 | High | Medium | Init chain, file/URL import, export, source management |
| `storage.ts` | 1000+ | Very High | Medium | Encryption key, master password, migration, quota |
| `trustChecker.ts` | 372 | Medium | Medium | Alert logic, domain check flow, safety mode |
| `main.ts` | 1329 | Very High | Very Hard | escapeHtml, SVG icons, pending pages, record flow |

## Priority Tier 4 — Lower Priority

| File | Lines | Complexity | Testability | Why Lower |
|------|-------|-----------|-------------|-----------|
| `contentExtractor.ts` | 721 | High | Hard | Heavy DOM dependency |
| `extractor.ts` | 602 | High | Hard | Content script, Chrome APIs |
| `loader.ts` | 205 | Medium | Hard | Dynamic imports, IIFE |
| `cspSettings.ts` | 330 | High | Hard | Dashboard DOM + permissions |
| `dashboard.ts` | 1500+ | Very High | Very Hard | Massive DOM orchestration |
| `models-dev-dialog.ts` | 464 | High | Hard | Dialog with fetch + DOM |
| `offscreen.ts` | 148 | Medium | Hard | Chrome Prompt API |
| `index.ts` / `ublockImport.ts` | ~15-18 | Low | Easy | Re-exports only |
| `trustDbSchema.ts` | 139 | Low | Easy | Pure types/enums |

## Recommended Testing Order

1. **Week 1:** All Tier 1 files (9 files, ~870 lines total) — pure logic, fast wins
2. **Week 2:** Tier 2 files (5 files, ~2,800 lines) — core utilities
3. **Week 3:** Top Tier 3 files (`trustSettings.ts`, `ublockImport/index.ts`, `storage.ts`)
4. **Week 4:** Remaining Tier 3 + selected Tier 4 files
