# AGENTS.md

This file provides topic-based guidance for agents working on the Yasumaro Chrome extension project.

> For setup, CI pipeline, coding standards, PR workflow, and release flow, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Where to Start

| Task | Read first |
|------|-----------|
| Adding a feature | [Architecture Map](dev-docs/ARCHITECTURE_MAP.md) + [Development Patterns](#development-patterns) |
| Fixing a bug | [Debugging Guide](dev-docs/DEBUGGING_GUIDE.md) |
| Reviewing code or security | [Security Review Guide](dev-docs/SECURITY_REVIEW_GUIDE.md) + [Error Codes](dev-docs/ERROR_CODES.md) |
| Writing or updating docs | [Documentation Guide](dev-docs/DOCUMENTATION_GUIDE.md) + [Naming Guidelines](dev-docs/NAMING_GUIDELINES.md) |
| Testing | [Test Rule](dev-docs/TEST_RULE.md) + [Testing Guide](dev-docs/TESTING_GUIDE.md) |
| A test fails intermittently or only under load | [Test Rule: 実時間待ちの禁止と代替手段](dev-docs/TEST_RULE.md#実時間待ちの禁止と代替手段) |
| Optimizing performance | [Performance Guide](dev-docs/PERFORMANCE_GUIDE.md) + [Performance Testing](docs/PERFORMANCE_TEST.md) |
| Preparing a release | [Release](#release) |
| Design specs & architecture decisions | [Design Specifications](dev-docs/DESIGN_SPECIFICATIONS.md) + [ADR](dev-docs/ADR/) |
| API endpoints / design tokens | [API Endpoints](dev-docs/API_ENDPOINTS.md) + [Design Tokens](dev-docs/DESIGN_TOKENS.md) |
| i18n / accessibility | [i18n Guide](docs/i18n-guide.md) + [Accessibility Guide](docs/ACCESSIBILITY.md) |
| Contribution workflow | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## Overview

This is a **Manifest V3 Chrome extension** with a modular architecture:
- Service worker background script coordinates all operations
- Content script tracks user engagement on web pages
- Popup UI provides configuration and testing interface
- Modular client classes handle AI providers and Obsidian integration

## Quick Start

```bash
npm install              # Install dependencies
npm run build:watch      # Build and watch for development changes
npm run validate         # Lint (oxlint) + type check (tsgo) + run tests (pre-commit gate)
```

To load the unpacked extension: run `npm run build`, open `chrome://extensions`, enable Developer mode, then "Load unpacked" → select `dist/chromium-mv3`.

---

## Architecture

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Service Worker | `entrypoints/background/` + `src/background/` | Coordinates all operations ― ObsidianClient, AIClient, sessionAlarmsManager, Mutex/ServiceWorkerContext, recordingLogic |
| Popup UI | `entrypoints/popup/` + `src/popup/` | Configuration & recording UI ― domainFilter, ublockImport, settings, utils (focusTrap, i18n) |
| Dashboard / Options | `entrypoints/options/` + `src/dashboard/` | Settings and management interface |
| Offscreen | `entrypoints/offscreen.html` + `src/offscreen/` | DOM operations that cannot run in service workers |
| Content Scripts | `entrypoints/content/` + `src/content/` | Engagement tracking ― loader, extractor |

Full component/file tree and the feature-location table: [dev-docs/ARCHITECTURE_MAP.md](dev-docs/ARCHITECTURE_MAP.md).

### Chrome Extension Lifecycle Quirks

- Service workers can be terminated at any time (stateless)
- Offscreen documents have limited lifecycle and cannot persist UI state
- Content scripts reload on page navigation
- Message passing is async, no return values
- `chrome.storage.local.get/set` is preferred for state
- Not suitable for persistent background tasks

### Concurrency Management

- **Mutex** (`src/utils/Mutex.ts`): Prevents race conditions in service worker
- **Optimistic Lock** (`src/utils/storage/storageTransaction.ts`): Version-based conflict detection for storage updates
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
- **HTML escaping**: Use `escapeHtml` from `src/utils/htmlEscape.ts` (canonical). `src/popup/domUtils.ts` and `src/popup/errorUtils.ts` re-export it as compatibility shims. Markdown-link handling lives in `src/utils/markdownSanitizer.ts` (different responsibility). For element clearing, use `clearElement` from `src/utils/domClear.ts` (canonical); `src/popup/domUtils.ts` re-exports it as a compatibility shim

---

## Testing

Test commands: [CONTRIBUTING.md](CONTRIBUTING.md). After code changes, run `npm run build` before testing in Chrome Extension. Manual testing: [dev-docs/TESTING_GUIDE.md](dev-docs/TESTING_GUIDE.md). Read [dev-docs/TEST_RULE.md](dev-docs/TEST_RULE.md) before writing or changing tests.

---

## Async / Timing Failures

Full workflow for a timing-related test failure (cause classification, matching fixes,
definition of done, exceptions): [dev-docs/TEST_RULE.md § 実時間待ちの禁止と代替手段](dev-docs/TEST_RULE.md#実時間待ちの禁止と代替手段).

### Waiting for processes in the shell

Do not write `cmd & sleep N`. To wait for a command to finish, block on it (run it in the foreground, or `wait` on its PID). To wait for a long-running process to become ready, poll a readiness condition with an upper bound, e.g. `for i in $(seq 1 120); do curl -sf http://localhost:PORT/ && break; sleep 0.5; done`. macOS has no `timeout` command (exit 127); use a bounded loop or `gtimeout`.

**Keep every polling interval at 10 seconds or less.** This applies to `gh run watch --interval`, `playwright --repeat-each` pacing, readiness polling, and any `sleep N` used to wait on something:

```bash
gh run watch <id> --exit-status --interval 10   # OK
gh run watch <id> --exit-status --interval 30   # violation
```

The default of 3 seconds is fine. Raising it above 10 is not: the interval is the **worst-case latency of each individual wait**, so a 30-second interval means every wait can waste up to 30 seconds of wall clock, and that cost is paid again on each poll. It also delays `--exit-status` reporting by up to one interval after the run is already finished. The cost multiplies across every wait in a session, and it is invisible ― the work is not slower in any visible way, it just sits there.

`src/__tests__/agent-poll-interval.test.ts` fails if this rule's text disappears from `AGENTS.md` or `.kilorules`, or if a file in the repository passes an interval above 10 to a watch/poll flag.

---

## Bug Fixing

Issue areas, debugging workflow, common fixes: [dev-docs/DEBUGGING_GUIDE.md](dev-docs/DEBUGGING_GUIDE.md). **High-risk areas for breaking changes:** manifest permissions, storage key structure, API endpoints.

---

## Code Review & Security

Non-negotiables for every review:

- No hardcoded API keys or sensitive data; proper input validation for all external data
- Manifest V3 compliance (service worker, not background scripts); no `eval()` or inline scripts
- Proper async handling in the service worker; cleanup of listeners and intervals (no memory leaks)

Full checklist, threat model, security controls, and privacy features: [dev-docs/SECURITY_REVIEW_GUIDE.md](dev-docs/SECURITY_REVIEW_GUIDE.md). Structured error codes: [dev-docs/ERROR_CODES.md](dev-docs/ERROR_CODES.md).

---

## Documentation & i18n

Docs inventory, i18n rules, update checklist: [dev-docs/DOCUMENTATION_GUIDE.md](dev-docs/DOCUMENTATION_GUIDE.md). Naming rules: [dev-docs/NAMING_GUIDELINES.md](dev-docs/NAMING_GUIDELINES.md). **PRIVACY.md sync (critical):** `public/PRIVACY.md` and `docs/PRIVACY.md` must stay identical; whichever you edit, copy the same changes to the other file.

---

## Documentation Characters (Shift-JIS + enumerated emoji)

Documents in `pbi/`, `dev-docs/`, `docs/`, `public/`, and root `*.md` must survive a Shift-JIS
(JIS X 0208 / CP932) round trip; rule files themselves are out of scope (they quote the
forbidden characters). Never use `—` (EM DASH, U+2014); use `―` (U+2015).

- Substitute out-of-range symbols and accents with their JIS equivalents: `≤`→`≦`, `≥`→`≧`,
  `≈`→`≒`, `↔`/`↕`/`⇄`/`⟺`→`⇔`, `↳`→`└`, `•`→`・`, `–`→`-`, `²`→`^2`, `µ`→`μ`, `©`→`(c)`,
  `█`/`░`→`#`/`-`, `⎯`→`-`, `›`→`>`, `⊊`→`⊂`; accents lose the diacritic (`Ō`→`O`, `ç`→`c`).
- Emoji: only the `EMOJI` Set in `scripts/check-docs-chars.mjs` (add new glyphs there first).
  Mojibake (Hangul, Simplified Chinese, `U+FFFD`, Arabic) is never exempted: rewrite the
  sentence (PBI `2026-10-19-13`). Product glyphs `∉` and `⏎` are quoted on purpose.
- Enforced by `npm run validate` via `node scripts/check-docs-chars.mjs`
  (`--list` prints every offending character; exits 1 on a violation).

---

## Performance

Metrics, optimization targets, browser compatibility: [dev-docs/PERFORMANCE_GUIDE.md](dev-docs/PERFORMANCE_GUIDE.md) (verify against its key metrics when optimizing). Benchmark harness: [docs/PERFORMANCE_TEST.md](docs/PERFORMANCE_TEST.md), [bench/README.md](bench/README.md). Run `npm run bench:micro` before/after an optimization and attach the diff to the PR.

---

## Editing Notes

- `recordingPipeline-full.test.ts` and other large test files are edited repeatedly: Read the file again right before each Edit (formatter hooks and subagents rewrite it), and give `old_string` enough context to be unique.
- Do not chain `cd`, `rm -rf`, `git add -A` or `~/Secrets` access into one Bash command (`;`, `&&`, heredoc included); a deny rule on any part rejects the whole command. Instead:
  - Stage with `git -C <abs> add <file...>` (explicit files), then run `git -C <abs> commit` as a separate command.
  - Run deletion as its own `rm -rf <abs path>` command.
  - For multi-step or heredoc work, Write a script to the scratchpad and run it as a single command.
- Several changes to one file go into one Edit or one Write. If an Edit fails with "modified since read", Read again and retry once with all changes combined.

### Batch edits to one file

- Issue one `apply_diff` call containing multiple SEARCH/REPLACE blocks instead of a sequence
  of single-block diffs to the same file; use one `write_to_file` for a full rewrite.
- Run `npm run build` + tests after the batch, not between chunks.

---

## Release

The pre-release checklist and the release flow live in [CONTRIBUTING.md](CONTRIBUTING.md):
the code-review checklist (tests via `npm run validate`, security / i18n / accessibility /
manual checks) covers verification, and リリースフロー / Release Process covers the
`CHANGELOG.md` release notes and the version bump in `manifest.json` and `package.json`
(`cli/Cargo.toml` kept in sync).

---

## graphify

Graphify rules live in `AGENTS.local.md` (gitignored, local-only). Read it if present.

## arch-delivery-loop

Closed loop: architecture diagnosis → PBI creation (RICE prioritization) → autonomous implementation → `make clean test` → version bump. Skill file: `.agents/skills/arch-delivery-loop/SKILL.md` ― read it and follow its phases before executing. Trigger on 「アーキテクチャから実装まで一気に」「全部やって」「積み残しを閉じて」, or when the user names `arch-delivery-loop`.
