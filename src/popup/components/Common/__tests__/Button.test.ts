/**
 * Button.svelte Component Test
 * Manual verification: npm run build && load in Chrome
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

const COMPONENT_DIR = resolve(__dirname, '..');
const COMPONENT_PATH = resolve(COMPONENT_DIR, 'Button.svelte');

describe('Button.svelte', () => {
  it('should exist', () => {
    expect(existsSync(COMPONENT_PATH)).toBe(true);
  });

  it('should have required exports', () => {
    const fs = require('fs');
    const content = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    
    expect(content).toContain("export let variant = 'primary'");
    expect(content).toContain("export let disabled = false");
    expect(content).toContain('<button');
    expect(content).toContain('<slot />');
  });
});