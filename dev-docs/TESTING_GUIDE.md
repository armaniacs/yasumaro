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

## Test-support placement convention (PBI-14)

- Test-only doubles, fakes, and seams live under `src/**/__tests__/helpers/` (e.g. `src/content/__tests__/helpers/`, existing `src/background/__tests__/helpers/`).
- Production files must not define test-only symbols; production code must not import from `__tests__/helpers/`.
- New suffixes (`*.testkit.ts`) or top-level `src/test-support/` directories are not used.
- chrome-dependent handlers are split into a deps-injected named function in `src/` (entrypoint only registers) so unit tests call them without chrome mocks.

After code changes, run `npm run build` before testing in Chrome Extension.
