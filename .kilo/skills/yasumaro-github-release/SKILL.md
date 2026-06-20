---
name: yasumaro-github-release
description: |
  Create a GitHub release for the Yasumaro Chrome extension project. Use this skill whenever the user asks to
  release a new version, create a git tag, publish a GitHub release, cut a release, or bump the version for this
  repository. This skill enforces the correct brand name (Yasumaro, never Obsidian Weave) and the correct
  repository URL (armaniacs/Yasumaro, never armaniacs/obsidian-weave). It validates version consistency across
  package.json, package-lock.json, and wxt.config.ts, updates CHANGELOG.md, and generates release notes with
  the proper branding.
---

# Yasumaro GitHub Release Skill

This skill creates a GitHub release for the **Yasumaro** Chrome extension project while preventing the common
mistakes that have happened in the past:

- Using the old product name **"Obsidian Weave"** in release notes
- Linking to the old repository **"armaniacs/obsidian-weave"**
- Forgetting to update `CHANGELOG.md`
- Publishing a release with mismatched version numbers

## Brand Guardrails

The product is **Yasumaro**. The repository is **armaniacs/yasumaro**.

Never use these old/incorrect values in any release artifact:

| ❌ Do not use | ✅ Use instead |
|--------------|----------------|
| Obsidian Weave | Yasumaro |
| armaniacs/obsidian-weave | armaniacs/yasumaro (or armaniacs/Yasumaro in display text) |
| obsidian-smart-history | yasumaro |

Before any release, run the bundled script to check for forbidden references:

```bash
node .kilo/skills/yasumaro-github-release/scripts/check-release-branding.js
```

Also grep these locations for the old strings:

- `.github/workflows/release.yml`
- `CHANGELOG.md`
- `package.json`
- `wxt.config.ts`
- Any release notes you generate

If any forbidden reference is found, fix it before proceeding.

## Pre-Release Checklist

Run these steps before creating the tag or release:

1. **Version consistency**
   - Read `package.json`, `package-lock.json`, and `wxt.config.ts`.
   - Ensure all three have the same version.
   - If `package-lock.json` is out of sync, run `npm install --package-lock-only`.

2. **CHANGELOG check**
   - Read `CHANGELOG.md`.
   - Ensure the top entry matches the version you are about to release.
   - If the top entry does not exist or has the wrong version, ask the user how to proceed.

3. **Workflow brand check**
   - Run `node .kilo/skills/yasumaro-github-release/scripts/check-release-branding.js`.
   - If it fails, edit `.github/workflows/release.yml` to use `Yasumaro` and `armaniacs/Yasumaro`.

4. **Uncommitted changes**
   - Run `git status -sb`.
   - If there are uncommitted changes relevant to the release, commit them.
   - Never create a release tag on a dirty working tree unless the user explicitly says to.

## Release Workflow

Follow these steps in order:

1. Confirm the version number with the user if they have not provided it.
2. Run the pre-release checklist above.
3. If `CHANGELOG.md` needs a new entry, draft it from recent commits and present it to the user for approval.
4. Commit any pending changes.
5. Create and push the git tag: `git tag v<version>` and `git push origin v<version>`.
6. Generate release notes with:
   ```bash
   node .kilo/skills/yasumaro-github-release/scripts/generate-release-notes.js <version> > release-notes.md
   ```
7. Create the GitHub release with the correct title and notes:
   ```bash
   gh release create v<version> --title "Yasumaro v<version>" --notes-file release-notes.md
   ```

### Release Notes Template

The generated release body always follows this exact format:

```markdown
## Yasumaro v{VERSION}

See [CHANGELOG.md](https://github.com/armaniacs/Yasumaro/blob/main/CHANGELOG.md) for details.

{CHANGELOG_ENTRY_BODY}
```

The script `generate-release-notes.js` extracts `{CHANGELOG_ENTRY_BODY}` automatically from the current top entry
in `CHANGELOG.md`.

## Common Pitfalls to Avoid

- Do not assume the release title format. Always use `Yasumaro v{VERSION}`.
- Do not use `https://github.com/armaniacs/obsidian-weave` anywhere.
- Do not create a tag before committing pending changes.
- Do not ignore version-consistency test failures.
- Do not add extra narrative to the release body that is not in `CHANGELOG.md`.

## After Release

Verify the release by opening `https://github.com/armaniacs/yasumaro/releases/tag/v<version>` and checking:

- The release title says "Yasumaro v..."
- The CHANGELOG link points to `armaniacs/Yasumaro`
- The body contains the correct changelog entry

If anything is wrong, delete and recreate the release with the corrected notes.
