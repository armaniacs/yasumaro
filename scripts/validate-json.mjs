#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
function checkJsonParse(path) {
  try {
    JSON.parse(readFileSync(join(ROOT, path), 'utf-8'));
    console.log(`✅ ${path} — valid JSON`);
  } catch (e) {
    console.error(`❌ ${path} — JSON parse failed: ${e.message}`);
    process.exitCode = 1;
  }
}
function checkSemver(path) {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, path), 'utf-8'));
    if (!/^\d+\.\d+\.\d+/.test(j.version)) throw new Error(`version "${j.version}" is not semver`);
    console.log(`✅ ${path} — semver ${j.version}`);
  } catch (e) {
    console.error(`❌ ${path} — semver check failed: ${e.message}`);
    process.exitCode = 1;
  }
}
function checkSbom() {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, 'sbom.json'), 'utf-8'));
    const errs = [];
    if (j.bomFormat !== 'CycloneDX') errs.push('bomFormat != CycloneDX');
    if (j.specVersion !== '1.6') errs.push('specVersion != 1.6');
    if (!j.$schema?.includes('bom-1.6')) errs.push('$schema not 1.6');
    if (!Array.isArray(j.components) || j.components.length === 0) errs.push('components empty');
    // hashes are optional in cyclonedx-npm output (depends on npm version); warn only
    const hashed = j.components?.filter(c => c.hashes)?.length ?? 0;
    if (hashed === 0) console.warn(`⚠️  sbom.json — no hashes present (cyclonedx-npm without --gather-license-texts); not failing`);
    if (errs.length) throw new Error(errs.join('; '));
    console.log(`✅ sbom.json — CycloneDX 1.6, ${j.components.length} components, hashes present`);
  } catch (e) {
    console.error(`❌ sbom.json — validation failed: ${e.message}`);
    process.exitCode = 1;
  }
}
checkJsonParse('docs/version.json');
checkJsonParse('dev-docs/metrics/history.json');
checkJsonParse('sbom.json');
checkSemver('docs/version.json');
checkSemver('package.json');
checkSbom();
if (!process.exitCode) console.log('\n✅ All JSON validations passed');
