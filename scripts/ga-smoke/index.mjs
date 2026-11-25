#!/usr/bin/env node

/**
 * index.mjs — GA Release Smoke Runner (`npm run smoke:ga`).
 *
 * Orchestrates:
 *   Stage 1: Build & verify OW_E2E_PROBE=0 distribution ZIPs (chrome, edge, firefox)
 *   Stage 2: Launch deterministic local fixture servers on permitted loopback ports
 *   Stage 3: Drive real Chrome 158 / Edge 158 / Firefox Dev Edition 159 fresh profiles
 *   Stage 4: Optional interactive `--assisted` SQLite-monitored Chrome UI check
 *   Stage 5: Emit Shift-JIS-compliant report.md / report.json (with secret leak guard)
 *
 * Usage:
 *   node scripts/ga-smoke/index.mjs [options]
 *
 * Options:
 *   --browsers=chrome,edge,firefox   Subset of browsers to test (default: all 3)
 *   --skip-build                     Reuse existing dist/yasumaro-<ver>-*.zip
 *   --live                           Also probe live Obsidian / Ollama when available
 *   --assisted                       Run guided SQLite-monitored Chrome UI step (default on TTY)
 *   --no-assisted                    Non-interactive mode (CI / unattended run)
 *   --write-log                      Append run log to dev-docs/manual-tests/release-ga-smoke.md
 *   --help                           Show this help
 */

import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAndExtractArtifacts,
  collectEnvironmentMetadata,
  SUPPORTED_BROWSERS,
} from './buildAndVerifyArtifacts.mjs';
import { launchChromiumSmokeSession } from './drivers/chromiumDriver.mjs';
import { launchFirefoxSmokeSession } from './drivers/firefoxDriver.mjs';
import { startFixtureSuite } from './fixtureServers.mjs';
import {
  collectTrackedSecrets,
  runBrowserSmokeSuite,
  runLocaleVerification,
} from './flows/runAllFlows.mjs';
import { appendRunLogToChecklist, writeSmokeReports } from './reporter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

export function parseCliArgs(argv = process.argv.slice(2), isTTY = Boolean(process.stdin.isTTY)) {
  const opts = {
    browsers: [...SUPPORTED_BROWSERS],
    flows: null,
    skipBuild: false,
    live: false,
    assisted: isTTY,
    writeLog: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--skip-build') {
      opts.skipBuild = true;
    } else if (arg === '--live') {
      opts.live = true;
    } else if (arg === '--assisted') {
      opts.assisted = true;
    } else if (arg === '--no-assisted' || arg === '--ci') {
      opts.assisted = false;
    } else if (arg === '--write-log') {
      opts.writeLog = true;
    } else if (arg.startsWith('--flows=')) {
      const nums = arg
        .slice('--flows='.length)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10);
      if (nums.length === 0) {
        throw new Error('--flows requires comma-separated flow numbers 1..10');
      }
      opts.flows = new Set(nums);
    } else if (arg.startsWith('--browsers=')) {
      const list = arg
        .slice('--browsers='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      for (const b of list) {
        if (!SUPPORTED_BROWSERS.includes(b)) {
          throw new Error(`Unknown browser "${b}". Supported: ${SUPPORTED_BROWSERS.join(', ')}`);
        }
      }
      if (list.length === 0) {
        throw new Error('--browsers requires at least one browser');
      }
      opts.browsers = list;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Yasumaro GA Release Smoke Runner

Usage:
  npm run smoke:ga -- [options]

Options:
  --browsers=chrome,edge,firefox   Browsers to run (default: chrome,edge,firefox)
  --skip-build                     Reuse existing dist/yasumaro-<ver>-*.zip
  --live                           Also probe live Obsidian / Ollama when available
  --assisted                       Interactive guided check for omnibox/shortcut/context menu
  --no-assisted                    Run fully non-interactive (skip guided browser UI prompts)
  --write-log                      Append run log to dev-docs/manual-tests/release-ga-smoke.md
  --help                           Print this help
`);
}

async function main() {
  const opts = parseCliArgs();
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const metadata = collectEnvironmentMetadata(ROOT_DIR, SUPPORTED_BROWSERS);
  const workDir = path.join(os.tmpdir(), `yasumaro-ga-smoke-work-${Date.now()}`);
  const reportDir = path.join(ROOT_DIR, 'reports', 'ga-smoke', `${metadata.extensionVersion}-${metadata.date}`);
  const screenshotsDir = path.join(reportDir, 'screenshots');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(screenshotsDir, { recursive: true });

  console.log(`Yasumaro GA Release Smoke Runner — v${metadata.extensionVersion} (${metadata.gitSha})`);
  console.log(`OS: ${metadata.os} | Node: ${metadata.nodeVersion}`);
  console.log(`Targets: ${opts.browsers.join(', ')} | live=${opts.live} | assisted=${opts.assisted}`);

  let fixtures = null;
  try {
    // Stage 1: Build & verify exact distribution ZIPs (OW_E2E_PROBE=0)
    const artifacts = buildAndExtractArtifacts({
      rootDir: ROOT_DIR,
      workDir,
      browsers: opts.browsers,
      skipBuild: opts.skipBuild,
    });

    // Stage 2: Start deterministic local fixture servers
    console.log('\n[Stage 2] Starting local fixture servers on permitted loopback ports...');
    fixtures = await startFixtureSuite({ workDir, rootDir: ROOT_DIR });
    console.log(
      `[Stage 2] Ready: article=${fixtures.article.baseUrl}, obsidian=${fixtures.obsidian.baseUrl}, ai=${fixtures.ai.baseUrl}, webhook=${fixtures.webhook.origin} (TLS: ${fixtures.webhook.tlsMode})`,
    );

    // Stage 3 (+ Stage 4 when assisted): Execute 10-flow suite per browser
    const suitesByBrowser = {};
    for (const browser of opts.browsers) {
      const unpackedDir = artifacts[browser].unpackedDir;
      const launchSession = (sessionOpts = {}) =>
        browser === 'firefox'
          ? launchFirefoxSmokeSession({ unpackedDir, ...sessionOpts })
          : launchChromiumSmokeSession({ browserName: browser, unpackedDir, ...sessionOpts });

      try {
        suitesByBrowser[browser] = await runBrowserSmokeSuite({
          browserName: browser,
          launchSession,
          fixtures,
          screenshotsDir,
          flows: opts.flows,
          live: opts.live,
          assisted: opts.assisted,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${browser.toUpperCase()}] Suite failed to start: ${message}`);
        suitesByBrowser[browser] = {
          browserName: browser,
          browserVersion: metadata.browsers[browser]?.version ?? 'unknown',
          results: Array.from({ length: 10 }, (_, idx) => ({
            id: idx + 1,
            name: `Flow ${idx + 1}`,
            status: 'fail',
            durationMs: 0,
            note: `ブラウザ起動失敗: ${message}`,
          })),
        };
      }
    }

    // Locale verification (ja + en-US) on the first Chromium-family browser (or first requested browser)
    const localeBrowser = opts.browsers.find((b) => b === 'chrome' || b === 'edge') ?? opts.browsers[0];
    console.log(`\n[Locale Check] Verifying ja & en-US UI on ${localeBrowser}...`);
    const localeUnpacked = artifacts[localeBrowser].unpackedDir;
    const localeLauncher = (sessionOpts = {}) =>
      localeBrowser === 'firefox'
        ? launchFirefoxSmokeSession({ unpackedDir: localeUnpacked, ...sessionOpts })
        : launchChromiumSmokeSession({ browserName: localeBrowser, unpackedDir: localeUnpacked, ...sessionOpts });

    let localeResults = null;
    try {
      localeResults = await runLocaleVerification({
        launchSession: localeLauncher,
        screenshotsDir,
      });
    } catch (err) {
      console.error(`[Locale Check] Failed: ${err.message}`);
    }

    // Stage 5: Generate Shift-JIS report & optional checklist log append
    const secrets = collectTrackedSecrets(fixtures, process.env);
    const { jsonPath, mdPath, markdownPayload } = writeSmokeReports({
      reportDir,
      metadata,
      suitesByBrowser,
      localeResults,
      secrets,
    });

    console.log(`\n[Stage 5] Reports written:`);
    console.log(`  - ${mdPath}`);
    console.log(`  - ${jsonPath}`);

    if (opts.writeLog) {
      const checklistPath = path.join(ROOT_DIR, 'dev-docs/manual-tests/release-ga-smoke.md');
      appendRunLogToChecklist(checklistPath, markdownPayload);
      console.log(`  - Appended run log to ${checklistPath}`);
    }

    const totalFailures = Object.values(suitesByBrowser).reduce(
      (sum, suite) => sum + suite.results.filter((r) => r.status === 'fail').length,
      0,
    );
    const localeFailed = localeResults && Object.values(localeResults).some((v) => !v.ok);

    if (totalFailures > 0 || localeFailed) {
      console.error(`\n[RESULT] GA smoke FAILED (${totalFailures} flow failures). See ${mdPath}`);
      process.exitCode = 1;
    } else {
      console.log(`\n[RESULT] GA smoke PASSED with 0 failures. See ${mdPath}`);
    }
  } finally {
    if (fixtures) {
      await fixtures.closeAll().catch(() => undefined);
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}

// Run only when executed directly as a CLI script.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(`[FATAL] ${err instanceof Error ? err.stack || err.message : String(err)}`);
    process.exit(1);
  });
}
