# Sanitize Title Newline Injection Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize `\r\n` to spaces in `sanitizeTitle` so newline-bearing page titles cannot inject Markdown rows into daily notes.

**Architecture:** Single-function change in `sanitizeTitle` (`src/utils/markdownFormatter.ts:62-69`) using the same rule as `sanitizeSummary` (`:79`). `sanitizeForMarkdownLinkText` is deliberately untouched to avoid side effects on other consumers (tag chain). Both `obsidianList` and `heading` styles are fixed through this one path.

**Tech Stack:** TypeScript (nodeNext, `.js` import extensions), Vitest, `npm run validate` gate.

---

## File Structure

- Modify: `src/utils/markdownFormatter.ts:62-69` — add newline-to-space normalization inside `sanitizeTitle` only.
- Modify: `src/utils/__tests__/markdownFormatter.test.ts` — add two tests (obsidianList + heading). No other files.

## PBI

`dev-docs/archived/pbi/2026-10-10-15-fix-sanitize-title-newline-injection.md`

---

### Task 1: Add the obsidianList regression test (red)

**Files:**
- Modify: `src/utils/__tests__/markdownFormatter.test.ts`
- Test: `src/utils/__tests__/markdownFormatter.test.ts`

The existing imports already include `buildEntryMarkdown` (`:3`). `EntryMarkdownStyle` includes `'obsidianList'` (`src/utils/markdownFormatter.ts:13`). The default branch (`:173-174`) renders `- <timestamp> [<title>](<url>)\n    - <tags><summary>`, i.e. exactly 2 lines for a tag-free entry — a newline in the title adds a third line, which is the assertion.

- [ ] **Step 1: Append the failing test inside `describe('buildEntryMarkdown (PBI-04 SSOT)', ...)`**

```ts
  it('normalizes newlines in title to spaces (obsidianList injection safety)', () => {
    const md = buildEntryMarkdown(
      { title: 'Line one\n    - injected', url: 'https://example.com/article', summary: 's' },
      'obsidianList',
    );
    expect(md).toContain('[Line one - injected](https://example.com/article)');
    expect(md.split('\n')).toHaveLength(2);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/__tests__/markdownFormatter.test.ts -t "normalizes newlines in title"`
Expected: FAIL — the title keeps the raw `\n`, the output has 3 lines, and the injected `    - injected` row is present.

- [ ] **Step 3: Commit the red test**

```bash
git add src/utils/__tests__/markdownFormatter.test.ts
git commit -m "test: pin title newline normalization (red)"
```

### Task 2: Normalize newlines in sanitizeTitle (green)

**Files:**
- Modify: `src/utils/markdownFormatter.ts:62-69`

- [ ] **Step 1: Apply the summary-identical rule to the title**

Replace the function body (keep the signature and fallback logic exactly):

```ts
function sanitizeTitle(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  const raw = opts?.titleFallback === false
    ? (input.title as string)
    : (input.title || input.url || (opts?.titleFallback ?? DEFAULT_TITLE_FALLBACK));
  const normalized = raw.replace(/\r?\n+/g, ' ').replace(/  +/g, ' ').trim();
  return sanitizeForMarkdownLinkText(normalized);
}
```

Notes: `sanitizeForMarkdownLinkText` itself is NOT modified. `input.title as string` cast for the `titleFallback === false` branch is preserved from the original. `\r`-only line endings are covered by `\r?\n+` only when followed by `\n`; a lone `\r` is additionally neutralized because `sanitizeForMarkdownLinkText` output is single-line by contract — if you find a lone-`\r` case in tests, extend the first regex to `/[\r\n]+/g` instead.

- [ ] **Step 2: Run the tests to verify green**

Run: `npx vitest run src/utils/__tests__/markdownFormatter.test.ts`
Expected: PASS, including the new test and all pre-existing tests unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/utils/markdownFormatter.ts src/utils/__tests__/markdownFormatter.test.ts
git commit -m "fix: normalize newlines in sanitizeTitle (injection safety)"
```

### Task 3: Add the heading-style regression test

**Files:**
- Modify: `src/utils/__tests__/markdownFormatter.test.ts`

The `heading` branch (`:160-171`) renders `# <title>` as its first line from the same `sanitizeTitle` output, so this test should already pass — it pins the second style.

- [ ] **Step 1: Append the test next to the obsidianList one**

```ts
  it('keeps the heading title line single-line for newline titles', () => {
    const md = buildEntryMarkdown(
      { title: 'Evil\n# Forged heading', url: 'https://example.com/article', summary: 's' },
      'heading',
    );
    const firstLine = md.split('\n')[0];
    expect(firstLine).toBe('# Evil # Forged heading');
  });
```

- [ ] **Step 2: Run to verify green**

Run: `npx vitest run src/utils/__tests__/markdownFormatter.test.ts`
Expected: PASS. If the exact spacing differs (collapse rule `  +` → single space), adjust only the expected string in the test — never the implementation — and re-run.

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/markdownFormatter.test.ts
git commit -m "test: pin heading title single-line for newline titles"
```

### Task 4: Full validation gate

- [ ] **Step 1: Run type check and validate**

Run: `npm run type-check`
Expected: exit 0.

Run: `npm run validate`
Expected: exit 0.

- [ ] **Step 2: Record results in the PBI checkboxes** (`Definition of Done` in `dev-docs/archived/pbi/2026-10-10-15-fix-sanitize-title-newline-injection.md`), commit:

```bash
git add dev-docs/archived/pbi/2026-10-10-15-fix-sanitize-title-newline-injection.md
git commit -m "docs: record PBI-15 validation results"
```
