#!/usr/bin/env node

/**
 * check-privacy.mjs — Privacy policy consistency verification.
 *
 * Verifies:
 * 1. public/PRIVACY.md and docs/PRIVACY.md are byte-identical
 *    (project critical rule: whichever is edited must be copied to the other).
 * 2. PRIVACY_POLICY_VERSION in src/utils/storage/privacyConsent.ts matches
 *    the "Consent Version" line in PRIVACY.md (format YYYY-MM-DD) — the
 *    date users actually agreed to. "Last Updated" is the document's
 *    revision date and may change without forcing re-consent; opt-in
 *    features carry their own consent (see navTrailConsent.ts).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const { header, pass, fail, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

const MONTHS = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};

function checkPrivacyFilesIdentical() {
  header('PRIVACY.md Sync');
  const pub = readFileSync(join(ROOT_DIR, 'public', 'PRIVACY.md'));
  const docs = readFileSync(join(ROOT_DIR, 'docs', 'PRIVACY.md'));
  if (pub.equals(docs)) {
    pass('public/PRIVACY.md and docs/PRIVACY.md are byte-identical');
    return true;
  }
  fail('public/PRIVACY.md and docs/PRIVACY.md differ — copy one to the other');
  return false;
}

export function readPolicyVersionConstant() {
  const src = readFileSync(
    join(ROOT_DIR, 'src', 'utils', 'storage', 'privacyConsent.ts'),
    'utf-8'
  );
  const match = src.match(/PRIVACY_POLICY_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

export function readPrivacyConsentVersion() {
  const md = readFileSync(join(ROOT_DIR, 'public', 'PRIVACY.md'), 'utf-8');
  const match = md.match(/Consent Version:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[1]];
  if (!month) return null;
  return `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
}

export function checkPolicyVersionMatch() {
  sectionBreak();
  info('Checking PRIVACY_POLICY_VERSION against PRIVACY.md Consent Version...');
  const constant = readPolicyVersionConstant();
  const consentVersion = readPrivacyConsentVersion();
  if (!constant) {
    fail('Could not extract PRIVACY_POLICY_VERSION from privacyConsent.ts');
    return false;
  }
  if (!consentVersion) {
    fail('Could not extract Consent Version date from public/PRIVACY.md');
    return false;
  }
  if (constant === consentVersion) {
    pass(`PRIVACY_POLICY_VERSION matches PRIVACY.md Consent Version: ${constant}`);
    return true;
  }
  fail(`Version mismatch: PRIVACY_POLICY_VERSION=${constant}, PRIVACY.md Consent Version=${consentVersion}`);
  return false;
}

// Run only when invoked directly (index.mjs spawns this file); importing it
// for tests must not produce output or exit.
if (process.argv[1] && process.argv[1].endsWith('check-privacy.mjs')) {
  const results = [checkPrivacyFilesIdentical(), checkPolicyVersionMatch()];
  sectionBreak();
  const allPassed = summary() && results.every(Boolean);
  process.exit(allPassed ? 0 : 1);
}
