# Testing Guide

> Manual testing requirements, scenarios, and limitations. Test commands (`npm test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:ui`, `type-check`, `validate`) are documented in [CONTRIBUTING.md](../CONTRIBUTING.md). Referenced from [AGENTS.md](../AGENTS.md).

## Manual Testing Required

Automated tests have limitations due to Chrome Extension architecture. Manual verification needed for:

- Chrome extension loading and permissions
- Actual Chrome extension functionality
- Real AI provider API calls
- Obsidian Local REST API integration
- Content script injection on real websites

## Test Environment Setup

1. Chrome browser with Developer Mode enabled
2. Obsidian with Local REST API plugin installed
3. Valid API keys for at least one AI provider
4. Test daily notes directory structure

## Key Test Scenarios

| Scenario | Coverage |
|----------|----------|
| Multiple AI provider configurations | `src/background/aiClient.ts`, `src/background/ai/providers/*.ts` |
| Various Obsidian daily note path formats | `src/background/obsidianClient.ts` |
| Different web page structures for content extraction | `src/content/extractor.ts` |
| Network failure scenarios | All API clients |
| Chrome extension permission states | `manifest.json` |
| Accessibility compliance | Lighthouse/axe DevTools |
| i18n coverage | `_locales/*` messages.json |

## Testing Limitations

- Cannot fully emulate Chrome Extension APIs in Jest
- Content script tests require jsdom environment
- Service worker tests have limitations
- Always verify with actual Chrome browser
- **Firefox**: the extension-level E2E (moz-extension:// origin) cannot be automated — Playwright only loads extensions in Chromium, and Playwright's Firefox build rejects unsigned sideloaded extensions (release-channel signature enforcement is locked; see PBI 2026-09-14-10 for the experiment record). Firefox coverage is: VFS probe + worker smoke + PII sanitizer WASM core probe in CI (`firefox-storage` job, real dist artifacts on http origin) + the manual checklist below. The WASM probe (`firefox-pii-wasm-probe.spec.ts`) is the automated Firefox-engine companion to Chromium's `pii-wasm-initialization.spec.ts`: it drives the committed `pii_sanitizer_bg.wasm` through init-from-same-origin-URL + masking inside a Firefox module worker; the extension-context `chrome.runtime.getURL` path itself stays under the manual checklist.

### Firefox manual smoke procedure

1. `npm run build:firefox` → `dist/firefox-mv3/`
2. `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → `manifest.json`
3. Verify: consent modal → record a page → dashboard search (FTS5) → preset switching (AI Summary Cleansing panel) → restart Firefox → records persist and no consent re-prompt
4. Diagnostics panel → SQLite test (final OPFS confirmation on the moz-extension:// origin)
5. PII sanitizer WASM init: with the browser console open, record a page whose content contains an email address → confirm no `PII WASM module unavailable` / `PII WASM sanitize call failed` warning is logged by the service worker (same assertion Chromium's `pii-wasm-initialization.spec.ts` automates)

## Test-support placement convention (PBI-14)

## Test-support placement convention (PBI-14)

- Test-only doubles, fakes, and seams live under `src/**/__tests__/helpers/` (e.g. `src/content/__tests__/helpers/`, existing `src/background/__tests__/helpers/`).
- Production files must not define test-only symbols; production code must not import from `__tests__/helpers/`.
- New suffixes (`*.testkit.ts`) or top-level `src/test-support/` directories are not used.
- chrome-dependent handlers are split into a deps-injected named function in `src/` (entrypoint only registers) so unit tests call them without chrome mocks.

After code changes, run `npm run build` before testing in Chrome Extension.
