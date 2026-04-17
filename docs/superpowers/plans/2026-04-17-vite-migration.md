# Vite Migration Implementation Plan

> **IMPORTANT: Vite Version Requirement** - This project MUST use Vite 8.0.x. Do NOT use Vite 7.x or lower.

**Investigation Notes (2026-04-17):**
- Tested CRXJS 2.4.0 with Vite 8 - FAILED with "Cannot resolve entry module" error
- CRXJS has known compatibility issues with Vite 8 (documented in CRXJS GitHub issues)
- **Decision: Use Vite WITHOUT CRXJS plugin**
- Manually configure entry points in rollupOptions instead
- This approach is more verbose but more reliable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `tsc` + manual file copy build with Vite, while maintaining identical extension functionality and gaining HMR for development.

**Architecture:** Use Vite WITHOUT CRXJS plugin. Manually configure entry points in rollupOptions based on manifest.json. Move static files to public/ for auto-copy, and keep tsc build as backup until Vite is proven.

**Tech Stack:** Vite 8.x (without CRXJS plugin), TypeScript, Vitest (existing)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Add Vite scripts, keep tsc as backup |
| `vite.config.ts` | Create | Vite configuration with manual entry points |
| `public/utils/trustDb/bloomfilter-vendor.mjs` | Move | Static file for auto-copy |
| `public/PRIVACY.md` | Move | Static file for auto-copy |
| `manifest.json` | No change | PRIVACY.md already in web_accessible_resources |
| `src/__tests__/vite-build.test.ts` | Create | Build output verification tests |

---

## Task 1: Install Vite Package

**Files:**
- Modify: `package.json`
- Test: Run `npm test` before and after

- [ ] **Step 1: Run baseline test suite**

Run: `npm test`
Expected: All tests pass (record results for comparison)

- [ ] **Step 2: Install @crxjs/vite-plugin@beta**

Run: `npm install @crxjs/vite-plugin@beta -D`
Expected: Package added to devDependencies

- [ ] **Step 3: Verify install didn't break tests**

Run: `npm test`
Expected: All tests pass (compare with baseline)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @crxjs/vite-plugin@beta"
```

---

## Task 2: Prepare Static Files

**Files:**
- Create: `public/utils/trustDb/` (directory)
- Create: `public/PRIVACY.md` (from root)
- Modify: `manifest.json`
- Test: Verify files exist in new locations

- [ ] **Step 1: Create public directory structure**

Run: `mkdir -p public/utils/trustDb`

- [ ] **Step 2: Move bloomfilter file**

Run: `cp src/utils/trustDb/bloomfilter-vendor.mjs public/utils/trustDb/`

- [ ] **Step 3: Move PRIVACY.md**

Run: `cp PRIVACY.md public/PRIVACY.md`

- [ ] **Step 4: Verify files exist**

Run: `ls -la public/utils/trustDb/ && ls -la public/PRIVACY.md`
Expected: Files present

- [ ] **Step 5: Update manifest.json - add PRIVACY.md to web_accessible_resources**

```json
// In manifest.json, update web_accessible_resources:
{
  "resources": [
    "content/extractor.js",
    // ... existing files ...
    "PRIVACY.md"
  ],
  "matches": ["<all_urls>"]
}
```

- [ ] **Step 6: Commit**

```bash
git add public/ manifest.json
git commit -m "chore: move static files to public/ for CRXJS auto-copy"
```

---

## Task 3: Create vite.config.ts

**Files:**
- Create: `vite.config.ts` (without CRXJS plugin)
- Test: Run `npx vite build` and verify output

> **IMPORTANT:** This project uses Vite WITHOUT CRXJS plugin due to compatibility issues. Entry points are configured manually in rollupOptions.

- [ ] **Step 1: Write failing test for build output**

Create: `src/__tests__/vite-build.test.ts`

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('Vite Build Output', () => {
  it('should produce popup/popup.js', () => {
    const exists = fs.existsSync(path.join(__dirname, '../../dist/popup/popup.js'));
    expect(exists).toBe(true);
  });

  it('should produce background/service-worker.js', () => {
    const exists = fs.existsSync(path.join(__dirname, '../../dist/background/service-worker.js'));
    expect(exists).toBe(true);
  });

  it('should produce content/loader.js', () => {
    const exists = fs.existsSync(path.join(__dirname, '../../dist/content/loader.js'));
    expect(exists).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test src/__tests__/vite-build.test.ts`
Expected: FAIL - files don't exist yet

- [ ] **Step 3: Create vite.config.ts**

Create: `vite.config.ts` (without CRXJS - manual entry points only)

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/popup.html'),
        'background/service-worker': path.resolve(__dirname, 'src/background/service-worker.ts'),
        'content/loader': path.resolve(__dirname, 'src/content/loader.ts'),
        dashboard: path.resolve(__dirname, 'src/dashboard/dashboard.html'),
        privacy: path.resolve(__dirname, 'src/privacy/privacy.html'),
        'dashboard/models-dev-dialog': path.resolve(__dirname, 'src/dashboard/models-dev-dialog.html'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  publicDir: 'public'
});
```

- [ ] **Step 4: Run build to verify it works**

Run: `npx vite build`
Expected: Build completes without errors

- [ ] **Step 5: Run test again**

Run: `npm test src/__tests__/vite-build.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts src/__tests__/vite-build.test.ts
git commit -m "feat: add vite.config.ts with manual entry points (no CRXJS)"
```

---

## Task 4: Update package.json Scripts

**Files:**
- Modify: `package.json`
- Test: Run new scripts and verify old build still works

- [ ] **Step 1: Write failing test for scripts**

Create: `src/__tests__/vite-scripts.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('Vite Scripts', () => {
  it('should have vite build script', async () => {
    const { execSync } = await import('child_process');
    try {
      execSync('npm run build', { stdio: 'pipe', cwd: process.cwd() });
    } catch (e) {
      expect(false).toBe(true);
    }
  });

  it('should produce dist directory', async () => {
    const fs = await import('fs');
    const exists = fs.existsSync('dist/popup/popup.js');
    expect(exists).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (scripts not added yet)**

Run: `npm test src/__tests__/vite-scripts.test.ts`
Expected: FAIL - scripts not configured

- [ ] **Step 3: Update package.json scripts**

In `package.json`, update scripts section:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:watch": "vite build --watch",
    "build:tsc": "npx tsc && cp -r manifest.json _locales icons data dist/ && cp PRIVACY.md dist/ && cp src/popup/popup.html dist/popup/ && cp src/popup/styles.css dist/popup/ && mkdir -p dist/dashboard && cp src/dashboard/dashboard.html dist/dashboard/ && cp src/dashboard/dashboard.css dist/dashboard/ && cp src/dashboard/models-dev-dialog.html dist/dashboard/ && cp src/dashboard/models-dev-dialog.css dist/dashboard/ && mkdir -p dist/privacy && cp src/privacy/privacy.html src/privacy/privacy.css dist/privacy/ && cp src/utils/trustDb/bloomfilter-vendor.mjs dist/utils/trustDb/bloomfilter-vendor.mjs",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "validate": "npm run type-check && npm test"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test src/__tests__/vite-scripts.test.ts`
Expected: PASS

- [ ] **Step 5: Verify old build still works**

Run: `npm run build:tsc`
Expected: Old build completes

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "feat: add Vite build scripts, keep tsc as backup"
```

---

## Task 5: Parallel Verification

**Files:**
- Create: `src/__tests__/vite-parallel-compare.test.ts`
- Test: Compare old and new build outputs

- [ ] **Step 1: Write comparison test**

Create: `src/__tests__/vite-parallel-compare.test.ts`

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Build Output Comparison', () => {
  const requiredFiles = [
    'popup/popup.js',
    'popup/popup.html',
    'popup/popup.css',
    'dashboard/dashboard.js',
    'dashboard/dashboard.html',
    'dashboard/dashboard.css',
    'background/service-worker.js',
    'content/loader.js',
    'manifest.json',
    'PRIVACY.md'
  ];

  for (const file of requiredFiles) {
    it(`should have ${file} in dist`, () => {
      const exists = fs.existsSync(path.join(__dirname, '../../dist', file));
      expect(exists).toBe(true);
    });
  }
});
```

- [ ] **Step 2: Run both builds**

Run: `npm run build:tsc && npm run build`

- [ ] **Step 3: Run comparison test**

Run: `npm test src/__tests__/vite-parallel-compare.test.ts`
Expected: PASS - all files present in both builds

- [ ] **Step 4: Run full test suite with Vite build**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/vite-parallel-compare.test.ts
git commit -m "test: add parallel build comparison tests"
```

---

## Task 6: Verify Extension in Chrome

**Files:**
- Test: Manual verification in Chrome browser

- [ ] **Step 1: Build with Vite**

Run: `npm run build`

- [ ] **Step 2: Load extension in Chrome**

1. Open Chrome: `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select `dist/` directory
5. Verify extension loads without errors

- [ ] **Step 3: Test popup opens**

Click extension icon, verify popup UI renders

- [ ] **Step 4: Verify service worker starts**

In Chrome extensions page, check "Service Worker" status - should be running

- [ ] **Step 5: Test basic recording flow** (if possible)

Record a test page, verify it saves to Obsidian

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: verify extension works with Vite build"
```

---

## Task 7: Full Switch (Optional)

**Files:**
- Modify: `package.json` (remove backup script)
- Test: Verify still works

- [ ] **Step 1: Remove backup script**

Remove `"build:tsc"` from package.json scripts

- [ ] **Step 2: Verify build still works**

Run: `npm run build && npm test`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: switch to Vite-only build"
```

---

## Verification Checklist

Before marking work complete:

- [ ] All phases complete with passing tests
- [ ] Extension loads in Chrome without errors
- [ ] Popup opens and functions correctly
- [ ] Service worker starts without errors
- [ ] HMR works in dev mode (optional test)
- [ ] Full test suite passes
- [ ] Documentation updated (AGENTS.md if needed)