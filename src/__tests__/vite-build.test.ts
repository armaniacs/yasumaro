import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('Vite Build Output', () => {
  it('should produce popup.js in dist root', () => {
    const exists = fs.existsSync(path.join(__dirname, '../../dist/popup.js'));
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