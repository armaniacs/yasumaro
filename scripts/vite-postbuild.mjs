#!/usr/bin/env node

/**
 * Post-build script for Vite
 * Copies static files from src to dist directories
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('Running post-build...');

// Copy static files to dist directories
const dirs = ['popup', 'dashboard', 'privacy'];
for (const dir of dirs) {
    const src = path.join(rootDir, 'dist/src', dir);
    const dest = path.join(rootDir, 'dist', dir);
    fs.mkdirSync(dest, { recursive: true });
    try {
        const files = fs.readdirSync(src);
        files.filter(f => f.endsWith('.html') || f.endsWith('.css'))
             .forEach(f => fs.copyFileSync(path.join(src, f), path.join(dest, f)));
    } catch (e) { /* ignore */ }
}

// Copy manifest and other static assets
const staticAssets = ['manifest.json', '_locales', 'icons', 'data'];
for (const s of staticAssets) {
    try {
        const p = path.join(rootDir, s);
        if (fs.statSync(p).isDirectory()) {
            fs.cpSync(p, path.join(rootDir, 'dist', s), { recursive: true });
        } else {
            fs.copyFileSync(p, path.join(rootDir, 'dist', s));
        }
    } catch (e) { /* ignore */ }
}

// Copy CSS files
try { fs.copyFileSync(path.join(rootDir, 'src/popup/styles.css'), path.join(rootDir, 'dist/popup/styles.css')); } catch (e) { /* ignore */ }
try { 
    fs.cpSync(path.join(rootDir, 'src/dashboard/dashboard.css'), path.join(rootDir, 'dist/dashboard/dashboard.css')); 
    fs.cpSync(path.join(rootDir, 'src/dashboard/models-dev-dialog.css'), path.join(rootDir, 'dist/dashboard/models-dev-dialog.css')); 
} catch (e) { /* ignore */ }
try { fs.copyFileSync(path.join(rootDir, 'src/privacy/privacy.css'), path.join(rootDir, 'dist/privacy/privacy.css')); } catch (e) { /* ignore */ }

console.log('Post-build complete');
