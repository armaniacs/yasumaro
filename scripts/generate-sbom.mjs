#!/usr/bin/env node
/**
 * generate-sbom.mjs — CycloneDX SBOM generation with license metadata correction.
 *
 * WHY: cyclonedx-npm derives licenses from each package's package.json `license`
 * field. `wa-sqlite@1.0.0` omits that field upstream, so its SBOM entry comes out
 * with empty `licenses` even though the bundled LICENSE file is MIT
 * (Copyright (c) 2023 Roy T. Hashimoto — verified 2026-09-05). npm `overrides`
 * cannot inject extra metadata fields into the installed package, so the
 * correction is applied here, post-generation.
 *
 * The table below is an allowlist: only packages whose LICENSE file was
 * human-verified belong in it. Adding an entry without verifying the LICENSE
 * file is a compliance bug, not a shortcut.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// License verified against the package's bundled LICENSE file by a human.
const LICENSE_CORRECTIONS = {
  'wa-sqlite': 'MIT',
};

execFileSync('npx', ['cyclonedx-npm', '--output-file', 'sbom.json'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const sbom = JSON.parse(readFileSync('sbom.json', 'utf-8'));
let corrected = 0;
for (const component of sbom.components ?? []) {
  const license = LICENSE_CORRECTIONS[component.name];
  if (license && (!component.licenses || component.licenses.length === 0)) {
    component.licenses = [{ license: { id: license } }];
    corrected += 1;
  }
}
writeFileSync('sbom.json', `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`SBOM license corrections applied: ${corrected}`);
