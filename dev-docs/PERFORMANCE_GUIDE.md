# Performance Guide

> Performance metrics, optimization targets, and browser compatibility for the extension. Referenced from [AGENTS.md](../AGENTS.md).

## Key Metrics

- Content script injection speed
- API response times for AI summarization
- Obsidian write operation frequency
- Memory usage in service worker
- Popup UI responsiveness

## Optimization Targets

1. **Content Extraction**: Efficient DOM parsing, minimal impact on page load
2. **API Calls**: Implement request queuing, respect rate limits
3. **Storage**: Efficient Chrome storage usage, batch operations
4. **Message Passing**: Minimize chrome.runtime.sendMessage overhead
5. **Error Recovery**: Fast fallback mechanisms for failed requests

## Benchmarking and Regression Detection

A two-layer harness lives in [`bench/`](../bench/README.md):

- **Micro** (`npm run bench:micro`) — Node + jsdom, no network. Wall-clock
  P50/P95/P99, DOM scan counts (`querySelectorAll`, TreeWalker traversal,
  `cloneNode`), heap deltas, and a scaling exponent per bench (`c1`–`c7` map to
  the optimization PBIs `pbi/2026-09-04-02`…`08`, plus `cleansing`).
- **E2E** (`npm run build && npm run bench:e2e`) — headed Chromium with the
  built extension under a fixed 4× CPU throttle. Autosave synchronous cost —
  extract + cleanse only (`ow-extract-start` → `ow-send-ready` marks in
  `src/content/visitReporter.ts`; the async send to the service worker is not
  included), Long Tasks / TBT, memory, Lighthouse, and service-worker cold start.

Regression gate: `npm run bench:check` compares against
`bench/baselines/micro.json` and exits non-zero when a **deterministic counter**
(DOM scan counts, `c5`/`c6` call counts) is more than 15% worse than baseline.
Wall-clock and heap are reported but not gated (too noisy on shared CI runners) —
use them as the before/after you attach to a PR. Run `bench:check` in CI for PRs
touching `contentExtractor`, `aiSummaryCleaner`, `contentDeduplicator`,
`src/content`, or the dashboard history panel. Update the baseline only for
intentional, reviewed changes: `npm run bench:baseline`.

## Browser Compatibility

- Focus on modern Chrome/Chromium browsers
- Test with latest Chrome version
- Consider Manifest V3 requirements
- Account for service worker lifecycle limitations
