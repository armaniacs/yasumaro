# Deep-Dig Findings — Tag Auto-Clustering & Normalization

Date: 2026-07-05

## Assumptions Challenged

| Assumption | Risk | Finding | Decision |
|------------|------|---------|----------|
| Existing tags should also be normalized | High | User confirmed: new records only. No retroactive migration needed. | Accept |
| Normalization dict UI lives in a separate panel | Medium | User wants it as a subsection in the existing Tags panel (panel-tags). | Accept |
| SQLite tag filter should be server-side for correctness | Medium | User chose client-side filter (JS filter on loaded page). Note: only filters current 20 entries — user aware of limitation. A tag search would be more correct but user chose simplicity. | Accept |
| Full preprocessing: trim + full-width/half-width + case-fold | Medium | User confirmed: apply all preprocess before dictionary match. | Accept |
| SQLite tags format: two formats exist | High | User chose dual-format parsing: prefer `#tag1 #tag2` format, fallback to `tag1, tag2` comma-separated format. | Accept |

## Risks Discovered

1. **Client-side tag filter limitation**: With server-side pagination (20 entries/page), a client-side filter will only filter the currently displayed page. User is aware of this trade-off. If needed later, FTS5 search on tags column can be added as a server-side solution.

2. **Normalization only applies to new records**: Tags already stored in SQLite or chrome.storage will retain their original form. This is acceptable per user decision.

3. **PrivacyPipeline.settings availability**: Confirmed that `PrivacyPipeline` receives the full `Settings` object (via `context.settings: Settings` in `RecordingContext`), and stores it as `this.settings`. The normalization dict will be accessible via `this.settings[StorageKeys.TAG_NORMALIZATION_DICT]` in `_processCloudResult()`.

4. **Tag format inconsistency in SQLite**: The `tags` column stores `#tag1 #tag2` for new recordings but `tag1, tag2` for migrated records. The dual parser handles both.

## Unresolved

- None — all key questions resolved via user decisions.

## Decisions

1. **Add new types**: `TagNormalizationEntry { from: string; to: string }`
2. **Add new StorageKey**: `TAG_NORMALIZATION_DICT: 'tag_normalization_dict'` with type `TagNormalizationEntry[]`, default `[]`
3. **Add pure function**: `normalizeTags()` in `tagUtils.ts` — applies trim → NFKC normalization (full-width→half-width, case-fold) → dictionary lookup
4. **Injection point**: `privacyPipeline.ts:215` — between `parseTagsFromSummary` call and tags assignment
5. **Dashboard UI**: New subsection in Tags panel (panel-tags), modeled after tagsPanel.ts patterns
6. **SQLite history panel**: Add tag badges with client-side click-to-filter, dual-format tag parsing
7. **Normalization scope**: New records only (no migration)
8. **Preprocessing**: trim → NFKC normalize (full-width/half-width, case-fold) → dictionary exact match
9. **Tag format parsing**: Dual parser (`#tag1 #tag2` primary, `tag1, tag2` fallback)
