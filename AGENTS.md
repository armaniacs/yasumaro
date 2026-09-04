# AGENTS.md

This file provides topic-based guidance for agents working on the Yasumaro Chrome extension project.

> For setup, CI pipeline, coding standards, PR workflow, and release flow, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Where to Start

| Task | Read first |
|------|-----------|
| Adding a feature | [Architecture Map](dev-docs/ARCHITECTURE_MAP.md) + [Development Patterns](#development-patterns) |
| Fixing a bug | [Debugging Guide](dev-docs/DEBUGGING_GUIDE.md) |
| Reviewing code or security | [Security Review Guide](dev-docs/SECURITY_REVIEW_GUIDE.md) |
| Writing or updating docs | [Documentation Guide](dev-docs/DOCUMENTATION_GUIDE.md) |
| Testing | [Testing Guide](dev-docs/TESTING_GUIDE.md) |
| Optimizing performance | [Performance Guide](dev-docs/PERFORMANCE_GUIDE.md) |
| Preparing a release | [Release](#release) |

---

## Overview

This is a **Manifest V3 Chrome extension** with a modular architecture:
- Service worker background script coordinates all operations
- Content script tracks user engagement on web pages
- Popup UI provides configuration and testing interface
- Modular client classes handle AI providers and Obsidian integration

### Quick References

| For Documentation | See |
|------------------|-----|
| Project Architecture | [dev-docs/DESIGN_SPECIFICATIONS.md](dev-docs/DESIGN_SPECIFICATIONS.md) |
| Architecture Decisions | [dev-docs/ADR/](dev-docs/ADR/) |
| Architecture Map (components & feature locations) | [dev-docs/ARCHITECTURE_MAP.md](dev-docs/ARCHITECTURE_MAP.md) |
| Error Codes | [dev-docs/ERROR_CODES.md](dev-docs/ERROR_CODES.md) |
| API Endpoints | [dev-docs/API_ENDPOINTS.md](dev-docs/API_ENDPOINTS.md) |
| Design Tokens | [dev-docs/DESIGN_TOKENS.md](dev-docs/DESIGN_TOKENS.md) |
| Naming Guidelines | [dev-docs/NAMING_GUIDELINES.md](dev-docs/NAMING_GUIDELINES.md) |
| Performance Guide | [dev-docs/PERFORMANCE_GUIDE.md](dev-docs/PERFORMANCE_GUIDE.md) |
| Testing / Debugging / Security / Docs | [dev-docs/TESTING_GUIDE.md](dev-docs/TESTING_GUIDE.md) · [DEBUGGING_GUIDE.md](dev-docs/DEBUGGING_GUIDE.md) · [SECURITY_REVIEW_GUIDE.md](dev-docs/SECURITY_REVIEW_GUIDE.md) · [DOCUMENTATION_GUIDE.md](dev-docs/DOCUMENTATION_GUIDE.md) |
| Contribution Guide | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Accessibility Guide | [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) |
| Performance Testing (benchmark harness) | [docs/PERFORMANCE_TEST.md](docs/PERFORMANCE_TEST.md) |
| i18n Guide | [docs/i18n-guide.md](docs/i18n-guide.md) |

## Quick Start

```bash
npm install              # Install dependencies
npm run build:watch      # Build and watch for development changes
npm run validate         # Type check + run tests (pre-commit gate)
```

To load the unpacked extension: run `npm run build`, open `chrome://extensions`, enable Developer mode, then "Load unpacked" → select `dist/chromium-mv3`.

---

## Architecture

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Service Worker | `entrypoints/background/` + `src/background/` | Coordinates all operations — ObsidianClient, AIClient, sessionAlarmsManager, Mutex/ServiceWorkerContext, recordingLogic |
| Popup UI | `entrypoints/popup/` + `src/popup/` | Configuration & recording UI — domainFilter, ublockImport, settings, utils (focusTrap, i18n) |
| Dashboard / Options | `entrypoints/options/` + `src/dashboard/` | Settings and management interface |
| Offscreen | `entrypoints/offscreen.html` + `src/offscreen/` | DOM operations that cannot run in service workers |
| Content Scripts | `entrypoints/content/` + `src/content/` | Engagement tracking — loader, extractor |

Full component/file tree and the feature-location table: [dev-docs/ARCHITECTURE_MAP.md](dev-docs/ARCHITECTURE_MAP.md).

### Chrome Extension Lifecycle Quirks

- Service workers can be terminated at any time (stateless)
- Offscreen documents have limited lifecycle and cannot persist UI state
- Content scripts reload on page navigation
- Message passing is async, no return values
- `chrome.storage.local.get/set` is preferred for state
- Not suitable for persistent background tasks

### Concurrency Management

- **Mutex** (`src/background/Mutex.ts`): Prevents race conditions in service worker
- **ServiceWorkerContext** (`src/background/ServiceWorkerContext.ts`): Manages context state
- **Optimistic Lock** (`src/utils/optimisticLock.ts`): Version-based conflict detection for storage updates
- Use `withOptimisticLock()` for critical storage operations

### TypeScript Conventions

- **ESM imports**: All imports must use `.js` extensions (including `.ts` source files)
- **Module resolution**: `nodeNext` mode with strict type checking
- **Testing**: Jest + jsdom with Web Crypto API polyfill (`@peculiar/webcrypto`)
- Run `npm run type-check` before committing to catch type errors

---

## Development Patterns

### Key Patterns

1. **Modular Design**: Keep specific functionality in dedicated client classes
2. **Async/Await**: All API calls should use async/await with proper error handling
3. **Chrome Extension APIs**: Use appropriate Chrome APIs (storage, tabs, scripting)
4. **Message Passing**: Communicate between components using Chrome's message passing API
5. **Error Handling**: Always implement try-catch blocks with user notifications

### Critical Considerations

- **i18n**: All user-facing text must use data-i18n attributes (see [i18n-guide.md](docs/i18n-guide.md))
- **Accessibility**: Follow WCAG 2.1 Level AA guidelines (see [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md))
- **Manifest V3**: No background scripts, use service workers
- **CSP**: Adhere to Content Security Policy
- **Offscreen API**: Use offscreen documents for DOM operations that cannot run in service workers

---

## Testing

> Test commands (`npm test`, `test:watch`, `test:coverage`, `test:e2e`, `type-check`, `validate`) are documented in [CONTRIBUTING.md](CONTRIBUTING.md). After code changes, run `npm run build` before testing in Chrome Extension.

Manual testing requirements, environment setup, key scenarios, and limitations: [dev-docs/TESTING_GUIDE.md](dev-docs/TESTING_GUIDE.md).

---

## Bug Fixing

Issue areas, debugging workflow, and common fixes: [dev-docs/DEBUGGING_GUIDE.md](dev-docs/DEBUGGING_GUIDE.md).

**High-risk areas for breaking changes:** manifest permissions, storage key structure, API endpoints.

---

## Code Review & Security

Non-negotiables for every review:

- No hardcoded API keys or sensitive data; proper input validation for all external data
- Manifest V3 compliance (service worker, not background scripts); no `eval()` or inline scripts
- Proper async handling in the service worker; cleanup of listeners and intervals (no memory leaks)

Full checklist, threat model, security controls, and privacy features: [dev-docs/SECURITY_REVIEW_GUIDE.md](dev-docs/SECURITY_REVIEW_GUIDE.md). Structured error codes: [dev-docs/ERROR_CODES.md](dev-docs/ERROR_CODES.md).

---

## Documentation & i18n

Documentation inventory, i18n formatting rules, and the documentation update checklist: [dev-docs/DOCUMENTATION_GUIDE.md](dev-docs/DOCUMENTATION_GUIDE.md). Naming rules: [dev-docs/NAMING_GUIDELINES.md](dev-docs/NAMING_GUIDELINES.md).

**PRIVACY.md sync (critical):** `public/PRIVACY.md` and `docs/PRIVACY.md` must stay identical. Whichever you edit, copy the same changes to the other file.

---

## Performance

Performance metrics, optimization targets, and browser compatibility notes live in [dev-docs/PERFORMANCE_GUIDE.md](dev-docs/PERFORMANCE_GUIDE.md). When optimizing, verify against the key metrics defined there.

Benchmark harness (micro + e2e + CI regression check): [docs/PERFORMANCE_TEST.md](docs/PERFORMANCE_TEST.md) for usage, [bench/README.md](bench/README.md) for implementation. Run `npm run bench:micro` before/after an optimization and attach the diff to the PR.

---

## Agent Coordination Notes

| Primary Agent | Coordinate With | When |
|---------------|-----------------|------|
| Feature | Security | Adding new API integrations |
| Bug Fix | Documentation | User-impacting fixes |
| Performance | Feature | During new feature development |
| All | Code Review | Verify compliance with guidelines |

Respect modular architecture and avoid cross-contamination of concerns.

---

## Release

Before releasing, verify:
1. [ ] All tests pass
2. [ ] Manual testing checklist complete
3. [ ] i18n coverage (both languages)
4. [ ] Accessibility audit (Lighthouse score)
5. [ ] Security review completed
6. [ ] CHANGELOG.md updated
7. [ ] Version number bumped in `manifest.json` and `package.json`

The release flow itself is documented in [CONTRIBUTING.md](CONTRIBUTING.md) (リリースフロー / Release Process).

---

## graphify

Graphify rules live in `AGENTS.local.md` (gitignored, local-only). Read it if present.
