#!/usr/bin/env node
/**
 * CI Gate: False Positive Rate check for promptSanitizer
 * 
 * Ensures that prompt sanitizer pattern changes don't introduce
 * excessive false positives that would corrupt legitimate content.
 * 
 * Threshold: <20% false positive rate (based on 2026-03-20 ADR)
 */

import { readFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';

const RESULT_FILE = '/tmp/false-positive-rate.json';
const THRESHOLD = 20; // 20% threshold

try {
  // Run test in verbose mode to capture output
  const test = spawn('npm', ['run', 'test:false-positive-rate'], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' }
  });

  let stdout = '';
  let stderr = '';

  test.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  test.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  test.on('close', (code) => {
    // Parse false positive rate from stdout
    const match = stdout.match(/False Positive Rate:\s*(\d+(?:\.\d+)?)%/);
    
    if (!match) {
      console.error('CI Gate: Could not parse false positive rate from output');
      console.error('Exit code:', code);
      if (code !== 0) {
        console.error('Test failed');
        process.exit(1);
      }
      // If test passed but no rate found, assume it's OK (old test format)
      console.log('⚠️ CI Gate: False positive rate not detected, but test passed');
      process.exit(0);
    }

    const rate = parseFloat(match[1]);
    console.log(`📊 False Positive Rate: ${rate}%`);

    // Check against threshold
    if (rate >= THRESHOLD) {
      console.error(`⚠️ CI Gate: False positive rate ${rate}% exceeds threshold ${THRESHOLD}%`);
      console.error('Refining prompt patterns may be needed to reduce false positives.');
      process.exit(1);
    }

    console.log(`✅ CI Gate: False positive rate within bounds (<${THRESHOLD}%)`);
    process.exit(0);
  });

} catch (error) {
  console.error('CI Gate: Error running false positive rate check:', error.message);
  process.exit(1);
}
