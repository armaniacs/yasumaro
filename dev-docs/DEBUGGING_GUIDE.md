# Debugging Guide

> Common issue areas, debugging workflow, and breaking-change risks. Referenced from [AGENTS.md](../AGENTS.md).

## Common Issue Areas & Files

| Issue Area | Primary Files |
|------------|---------------|
| API Integration Failures | `src/background/aiClient.ts`, `src/background/ai/providers/*.ts` |
| Obsidian Connection Issues | `src/background/obsidianClient.ts` |
| Content Script Not Injecting | `manifest.json`, `src/content/loader.ts`, `src/content/extractor.ts` |
| Settings Not Persisting | `src/utils/storage.ts` |
| Duplicate Entries | `src/background/service-worker.ts`, `src/background/recordingLogic.ts` |
| Focus Trap Issues | `src/popup/utils/focusTrap.ts` |
| Offscreen Document Issues | `src/offscreen/offscreen.ts` |
| Optimistic Lock Conflicts | `src/utils/optimisticLock.ts` |

## Debugging Workflow

1. Reproduce the issue consistently
2. Check browser extension error logs (`chrome://extensions`)
3. Inspect service worker logs (Extensions → Service Worker → inspect)
4. Inspect offscreen document logs (if applicable)
5. Test popup UI with browser dev tools
6. Verify API connectivity using built-in test functions

## Breaking Changes Risk

**High-risk areas:**
- Manifest permissions modifications
- Storage key structure changes
- API endpoint modifications
