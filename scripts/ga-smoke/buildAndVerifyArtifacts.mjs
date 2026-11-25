#!/usr/bin/env node

/**
 * buildAndVerifyArtifacts.mjs — Stage 1 of the GA Release Smoke Runner.
 *
 * Builds the exact distribution ZIPs produced by `.github/workflows/release.yml`
 * with `OW_E2E_PROBE=0`, extracts each ZIP into a clean temp directory, verifies
 * manifest version parity and complete absence of E2E probe symbols, and
 * collects host/browser metadata for the smoke report.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

export const SUPPORTED_BROWSERS = ['chrome', 'edge', 'firefox'];

/** Forbidden strings that must NEVER exist inside an OW_E2E_PROBE=0 bundle. */
export const FORBIDDEN_PROBE_MARKERS = [
  'owE2eProbeEnabled',
  'owE2eTestState',
  '__OW_E2E_PROBE__',
];

export const DEFAULT_BROWSER_PATHS = {
  darwin: {
    chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    firefox: [
      '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
      '/Applications/Firefox Nightly.app/Contents/MacOS/firefox',
      '/Applications/Firefox.app/Contents/MacOS/firefox',
    ],
  },
  linux: {
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    firefox: ['/usr/bin/firefox-developer-edition', '/usr/bin/firefox-nightly', '/usr/bin/firefox'],
  },
};

/** Mirrors normalizeManifestVersion in wxt.config.ts. */
export function normalizeManifestVersion(version) {
  return version.replace(/\+[^+]*$/, '').replace(/-[0-9A-Za-z.-]+$/, '');
}

/** Resolve an installed browser executable path for the current platform. */
export function resolveBrowserExecutable(browser, env = process.env) {
  const envKey = `GA_SMOKE_${browser.toUpperCase()}_BIN`;
  if (env[envKey] && existsSync(env[envKey])) {
    return env[envKey];
  }
  const platformMap = DEFAULT_BROWSER_PATHS[process.platform];
  if (!platformMap) return null;
  const candidate = platformMap[browser];
  if (Array.isArray(candidate)) {
    return candidate.find((p) => existsSync(p)) ?? null;
  }
  return candidate && existsSync(candidate) ? candidate : null;
}

/** Query a browser binary's `--version` string safely. */
export function probeBrowserVersion(executablePath) {
  if (!executablePath || !existsSync(executablePath)) return null;
  const res = spawnSync(executablePath, ['--version'], {
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) return null;
  return (res.stdout || res.stderr || '').trim().split('\n')[0]?.trim() || null;
}

/** Collect OS, Node, Git, Extension, and Browser versions for the run log. */
export function collectEnvironmentMetadata(rootDir, browsers = SUPPORTED_BROWSERS) {
  const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

  let osLabel = `${os.platform()} ${os.release()}`;
  if (process.platform === 'darwin') {
    const sw = spawnSync('sw_vers', [], { encoding: 'utf-8', timeout: 3000 });
    if (sw.status === 0) {
      const name = sw.stdout.match(/ProductName:\s*(.+)/)?.[1]?.trim() ?? 'macOS';
      const ver = sw.stdout.match(/ProductVersion:\s*(.+)/)?.[1]?.trim() ?? '';
      const build = sw.stdout.match(/BuildVersion:\s*(.+)/)?.[1]?.trim() ?? '';
      osLabel = `${name} ${ver}${build ? ` (${build})` : ''}`;
    }
  }

  const gitShaRes = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf-8',
    timeout: 3000,
  });
  const gitSha = gitShaRes.status === 0 ? gitShaRes.stdout.trim() : 'unknown';

  const browserMeta = {};
  for (const b of browsers) {
    const exe = resolveBrowserExecutable(b);
    browserMeta[b] = {
      executablePath: exe,
      version: probeBrowserVersion(exe) ?? 'not-installed',
    };
  }

  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return {
    date: localDate,
    timestamp: now.toISOString(),
    extensionVersion: pkg.version,
    manifestVersion: normalizeManifestVersion(pkg.version),
    os: osLabel,
    nodeVersion: process.version,
    gitSha,
    browsers: browserMeta,
  };
}

/** Recursively list files under a directory. */
function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Verify an unpacked distribution directory:
 * 1. `manifest.json` exists and its version matches `expectedManifestVersion`.
 * 2. Zero JS/MJS/HTML files contain any forbidden E2E probe marker.
 */
export function verifyUnpackedArtifact(unpackedDir, expectedManifestVersion) {
  const manifestPath = path.join(unpackedDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      errors: [`manifest.json missing in ${unpackedDir}`],
      manifestVersion: null,
      scannedFiles: 0,
    };
  }

  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    return {
      ok: false,
      errors: [`manifest.json invalid JSON: ${err.message}`],
      manifestVersion: null,
      scannedFiles: 0,
    };
  }

  if (manifest.version !== expectedManifestVersion) {
    errors.push(
      `manifest.json version mismatch: got "${manifest.version}", expected "${expectedManifestVersion}"`,
    );
  }

  const files = walkFiles(unpackedDir).filter((f) => /\.(?:[cm]?js|html)$/i.test(f));
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    for (const marker of FORBIDDEN_PROBE_MARKERS) {
      if (content.includes(marker)) {
        errors.push(`forbidden probe marker "${marker}" found in ${path.relative(unpackedDir, file)}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    manifestVersion: manifest.version,
    scannedFiles: files.length,
  };
}

/**
 * Build distribution ZIPs for the requested browsers with `OW_E2E_PROBE=0`,
 * extract each ZIP into `<workDir>/unpacked/<browser>`, and verify hygiene.
 */
export function buildAndExtractArtifacts({
  rootDir,
  workDir,
  browsers = SUPPORTED_BROWSERS,
  skipBuild = false,
  log = console.log,
}) {
  const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  const pkgVersion = pkg.version;
  const expectedManifestVersion = normalizeManifestVersion(pkgVersion);

  const buildEnv = { ...process.env, OW_E2E_PROBE: '0' };
  delete buildEnv.OW_BENCH;

  const artifacts = {};

  for (const browser of browsers) {
    if (!SUPPORTED_BROWSERS.includes(browser)) {
      throw new Error(`Unsupported browser "${browser}" (supported: ${SUPPORTED_BROWSERS.join(', ')})`);
    }

    const zipPath = path.join(rootDir, 'dist', `yasumaro-${pkgVersion}-${browser}.zip`);

    if (!skipBuild || !existsSync(zipPath)) {
      log(`[Stage 1] Building distribution ZIP for ${browser} (OW_E2E_PROBE=0)...`);
      const res = spawnSync('npx', ['wxt', 'zip', '-b', browser], {
        cwd: rootDir,
        env: buildEnv,
        stdio: 'inherit',
      });
      if (res.status !== 0) {
        throw new Error(`wxt zip -b ${browser} failed with exit code ${res.status}`);
      }
    } else {
      log(`[Stage 1] Reusing existing distribution ZIP for ${browser}: ${path.basename(zipPath)}`);
    }

    if (!existsSync(zipPath)) {
      throw new Error(`Expected distribution ZIP not found: ${zipPath}`);
    }

    const unpackedDir = path.join(workDir, 'unpacked', browser);
    mkdirSync(unpackedDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(unpackedDir, true);

    const verification = verifyUnpackedArtifact(unpackedDir, expectedManifestVersion);
    if (!verification.ok) {
      throw new Error(
        `Artifact verification failed for ${browser}:\n  - ${verification.errors.join('\n  - ')}`,
      );
    }

    log(
      `[Stage 1] Verified ${browser}: version=${verification.manifestVersion}, scanned=${verification.scannedFiles} files, probe-free OK`,
    );

    artifacts[browser] = {
      browser,
      zipPath,
      unpackedDir,
      verification,
    };
  }

  return artifacts;
}
