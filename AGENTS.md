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
| Testing | [Test Rule](dev-docs/TEST_RULE.md) + [Testing Guide](dev-docs/TESTING_GUIDE.md) |
| A test fails intermittently or only under load | [Async / Timing Failures](#async--timing-failures) |
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
| Test Rules (required reading before writing tests) | [dev-docs/TEST_RULE.md](dev-docs/TEST_RULE.md) |
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
- **Testing**: Vitest (config: `testDir/vitest.config.ts`). Rules: [dev-docs/TEST_RULE.md](dev-docs/TEST_RULE.md)
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
- **HTML escaping**: Use `escapeHtml` from `src/utils/htmlEscape.ts` (canonical). `src/popup/domUtils.ts` and `src/popup/errorUtils.ts` re-export it as compatibility shims. Markdown-link handling lives in `src/utils/markdownSanitizer.ts` (different responsibility). For element clearing, use `clearElement` from `src/popup/domUtils.ts`

---

## Testing

> Test commands (`npm test`, `test:watch`, `test:coverage`, `test:e2e`, `type-check`, `validate`) are documented in [CONTRIBUTING.md](CONTRIBUTING.md). After code changes, run `npm run build` before testing in Chrome Extension.

Manual testing requirements, environment setup, key scenarios, and limitations: [dev-docs/TESTING_GUIDE.md](dev-docs/TESTING_GUIDE.md).

Read [dev-docs/TEST_RULE.md](dev-docs/TEST_RULE.md) before writing or changing tests.

---

## Async / Timing Failures

### Principle

- Never make a test pass by adding a fixed-time wait: `await new Promise(r => setTimeout(r, N))`, `page.waitForTimeout(N)`, or `sleep N` in the shell. Raising `retry` / `retries` counts falls under the same rule.
- Why: a fixed wait hides the race instead of removing it. The test fails again when load or parallelism changes, and a real bug in production code (a missing `await`, wrong initialization order) goes unnoticed.
- Production code may wait on purpose (retry backoff in `src/utils/fetch.ts`, `src/utils/storage/storageTransaction.ts`). Such waits must be injectable (`SleepFn`, `StepDelayFn`, a `sleep` option) so that tests never wait in real time.

### When a failure looks timing-related

1. Classify the cause and write down the evidence:
   - missing `await` (the test does not wait for an async operation to finish)
   - wrong initialization order
   - waiting for an external process to start (dev server, offscreen document, worker)
   - reading right after a write that has not settled yet
   - state leaking between tests
2. Fix it with the matching technique from [TEST_RULE.md § 実時間待ちの禁止と代替手段](dev-docs/TEST_RULE.md#実時間待ちの禁止と代替手段), using the helpers in `testDir/waitPolicy.ts`: await the Promise or event that signals completion, wait for a condition with `waitForMock()` (or `expect.poll` in E2E), drive production timers with an injected sleep or `useTimerClock()`, or isolate setup and teardown per test. Do not call `vi.useFakeTimers()` with default options; it also fakes `queueMicrotask` and hangs dynamic imports.
3. If you cannot identify the cause, stop. Do not work around it with a wait. Report what you observed and your hypotheses.

### Waiting for processes in the shell

Do not write `cmd & sleep N`. To wait for a command to finish, block on it (run it in the foreground, or `wait` on its PID). To wait for a long-running process to become ready, poll a readiness condition with an upper bound, e.g. `timeout 60 bash -c 'until curl -sf http://localhost:PORT/; do sleep 0.5; done'`.

### Definition of done

A timing-related fix is not done after one green run. Run it repeatedly with retries disabled; every run must pass:

- Unit: `npx vitest run <file> --repeats=20`
- E2E: `npx playwright test <file> --repeat-each=10 --retries=0 --workers=4`
- ESLint rule tests: `npx vitest run eslint/__tests__ --repeats=20`

Rule tests reach the same gate through `createRepeatSafeRuleTester` in `eslint/__tests__/repeatSafeRuleTester.ts`; plain `new RuleTester` cannot, because ESLint allocates its duplicate-case registry inside the `describe` body and `--repeats` re-runs only the `it` body. See [ADR: ESLint rule tests and `vitest --repeats`](dev-docs/ADR/2026-09-26-eslint-ruletester-vitest-repeats.md).

The report must include the cause category, the fix, and the repeat commands with their results.

### Exceptions

A real-time wait is acceptable only when real time is what the code is about: tests that measure timing (crypto timing resistance, `bench/`), or deliberate spacing for a rate-limited external API. Put the reason on the line (`// eslint-disable-next-line local/no-test-sleep -- <reason>`) and mention it in the report.

Background and measurements: [ADR: test suite execution time contract](dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md).

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

## arch-delivery-loop

Closed loop: architecture diagnosis → PBI creation (RICE prioritization) → autonomous implementation → `make clean test` → version bump. Skill file: `.kilo/skills/arch-delivery-loop/SKILL.md` — read it and follow its phases before executing. Trigger on 「アーキテクチャから実装まで一気に」「全部やって」「積み残しを閉じて」, or when the user names `arch-delivery-loop`.
